// One DynamoDB table (pk, sk, ttl), on demand. Every key starts with its owner's id taken from a
// verified token, never from a request body. Key layout:
//
//   SITE#s / META              site            SITE#s / KEY#kid          site public key
//   SITE#s / MEMBER#u          membership      USER#u / SITE#s           the same, from the user's side
//   SITE#s / ITEM#i            item            ITEM#i / MSG#m            message
//   SITE#s / LOG#e             log event       SITE#s / INVITE#id        invite (listing)
//   USER#u / META              team user       EMAIL#e / META            email → user
//   USER#u / PASSKEY#c         passkey         PASSKEY#c / META          credential → user
//   USER#u / RECOVERY#h        recovery code   INVITE#h / META           invite by token hash
//   USER#u / PAT#id            token listing   PAT#h / META              token by hash
//   USER#u / PUSH#h            push device     USER#u / GRANT#g          connected agent
//   GRANT#g / META             agent grant's sites and scopes
//   JTI#j / META               assertion replay guard (TTL)
//   CHAL#id / META             WebAuthn challenge (TTL)
//   RATE#k / META              rate-limit counter (TTL)
//   OIDC#Model#id / META       oidc-provider records (adapter.ts)

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";

export type Rec = Record<string, unknown> & { pk: string; sk: string };

export class Db {
  readonly doc: DynamoDBDocumentClient;

  constructor(
    readonly table: string,
    client?: DynamoDBClient,
  ) {
    const c =
      client ??
      new DynamoDBClient(
        process.env.DYNAMO_ENDPOINT
          ? {
              endpoint: process.env.DYNAMO_ENDPOINT,
              region: process.env.AWS_REGION ?? "eu-west-2",
              credentials: { accessKeyId: "local", secretAccessKey: "local" },
            }
          : {},
      );
    this.doc = DynamoDBDocumentClient.from(c, {
      marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
    });
  }

  async get<T = Rec>(pk: string, sk: string, consistent = false): Promise<T | undefined> {
    const r = await this.doc.send(new GetCommand({ TableName: this.table, Key: { pk, sk }, ConsistentRead: consistent }));
    return r.Item as T | undefined;
  }

  async put(item: Rec, opts: { ifNotExists?: boolean } = {}): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: item,
        ...(opts.ifNotExists ? { ConditionExpression: "attribute_not_exists(pk)" } : {}),
      }),
    );
  }

  /** Put only if absent. Returns false if it already existed. */
  async putNew(item: Rec): Promise<boolean> {
    try {
      await this.put(item, { ifNotExists: true });
      return true;
    } catch (e) {
      if (isConditionFailure(e)) return false;
      throw e;
    }
  }

  async delete(pk: string, sk: string): Promise<void> {
    await this.doc.send(new DeleteCommand({ TableName: this.table, Key: { pk, sk } }));
  }

  /** Delete only if it exists; returns the deleted item (used to consume single-use things). */
  async consume<T = Rec>(pk: string, sk: string): Promise<T | undefined> {
    try {
      const r = await this.doc.send(
        new DeleteCommand({
          TableName: this.table,
          Key: { pk, sk },
          ConditionExpression: "attribute_exists(pk)",
          ReturnValues: "ALL_OLD",
        }),
      );
      return r.Attributes as T | undefined;
    } catch (e) {
      if (isConditionFailure(e)) return undefined;
      throw e;
    }
  }

  /** Set fields (undefined values are removed). Optional condition. Returns the new item. */
  async update<T = Rec>(
    pk: string,
    sk: string,
    set: Record<string, unknown>,
    opts: { condition?: string; values?: Record<string, unknown>; names?: Record<string, string>; add?: Record<string, number> } = {},
  ): Promise<T> {
    const names: Record<string, string> = { ...(opts.names ?? {}) };
    const values: Record<string, unknown> = { ...(opts.values ?? {}) };
    const sets: string[] = [];
    const removes: string[] = [];
    const adds: string[] = [];
    let i = 0;
    for (const [k, v] of Object.entries(set)) {
      const n = `#u${i}`;
      names[n] = k;
      if (v === undefined) removes.push(n);
      else {
        values[`:u${i}`] = v;
        sets.push(`${n} = :u${i}`);
      }
      i++;
    }
    for (const [k, v] of Object.entries(opts.add ?? {})) {
      const n = `#a${i}`;
      names[n] = k;
      values[`:a${i}`] = v;
      adds.push(`${n} :a${i}`);
      i++;
    }
    const parts = [];
    if (sets.length) parts.push(`SET ${sets.join(", ")}`);
    if (removes.length) parts.push(`REMOVE ${removes.join(", ")}`);
    if (adds.length) parts.push(`ADD ${adds.join(", ")}`);
    const r = await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { pk, sk },
        UpdateExpression: parts.join(" "),
        ExpressionAttributeNames: names,
        ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
        ConditionExpression: opts.condition ?? "attribute_exists(pk)",
        ReturnValues: "ALL_NEW",
      }),
    );
    return r.Attributes as T;
  }

  async query<T = Rec>(
    pk: string,
    opts: { prefix?: string; after?: string; before?: string; limit?: number; descending?: boolean } = {},
  ): Promise<T[]> {
    const out: T[] = [];
    let start: Record<string, unknown> | undefined;
    const names: Record<string, string> = { "#pk": "pk" };
    const values: Record<string, unknown> = { ":pk": pk };
    let cond = "#pk = :pk";
    if (opts.after !== undefined || opts.before !== undefined) {
      names["#sk"] = "sk";
      const lo = opts.after ?? opts.prefix ?? "";
      const hi = opts.before ?? (opts.prefix ? opts.prefix + "￿" : "￿");
      values[":lo"] = lo;
      values[":hi"] = hi;
      // BETWEEN is inclusive; the bounds are cursors, so drop exact matches below.
      cond += " AND #sk BETWEEN :lo AND :hi";
    } else if (opts.prefix) {
      names["#sk"] = "sk";
      values[":p"] = opts.prefix;
      cond += " AND begins_with(#sk, :p)";
    }
    do {
      const r = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: cond,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ScanIndexForward: !opts.descending,
          ExclusiveStartKey: start,
          ...(opts.limit ? { Limit: opts.limit + 2 } : {}),
        }),
      );
      for (const it of (r.Items ?? []) as Array<T & Rec>) {
        if (opts.after !== undefined && it.sk === opts.after) continue;
        if (opts.before !== undefined && it.sk === opts.before) continue;
        out.push(it);
      }
      start = r.LastEvaluatedKey;
      if (opts.limit && out.length >= opts.limit) return out.slice(0, opts.limit);
    } while (start);
    return out;
  }

  async transact(items: NonNullable<TransactWriteCommandInput["TransactItems"]>): Promise<void> {
    await this.doc.send(new TransactWriteCommand({ TransactItems: items }));
  }

  async deleteMany(keys: Array<{ pk: string; sk: string }>): Promise<void> {
    for (let i = 0; i < keys.length; i += 25) {
      const chunk = keys.slice(i, i + 25);
      await this.doc.send(
        new BatchWriteCommand({
          RequestItems: { [this.table]: chunk.map((k) => ({ DeleteRequest: { Key: { pk: k.pk, sk: k.sk } } })) },
        }),
      );
    }
  }
}

export function isConditionFailure(e: unknown): boolean {
  const name = (e as { name?: string })?.name ?? "";
  return name === "ConditionalCheckFailedException" || name === "TransactionCanceledException";
}

/** Strip the key attributes from a record. */
export function strip<T>(r: Rec | undefined): T | undefined {
  if (!r) return undefined;
  const { pk: _pk, sk: _sk, ttl: _ttl, ...rest } = r as Rec & { ttl?: unknown };
  return rest as T;
}

export function ttlAt(iso: string | number): number {
  const ms = typeof iso === "number" ? iso : Date.parse(iso);
  return Math.floor(ms / 1000);
}
