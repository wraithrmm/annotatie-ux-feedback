// The node-oidc-provider storage adapter, on the same DynamoDB table. Records expire through the
// table's TTL and are also checked on read (TTL deletion is lazy).
import type { Db } from "./db.js";

type Payload = Record<string, unknown> & { grantId?: string; uid?: string; userCode?: string; consumed?: number };

export function makeOidcAdapter(db: Db) {
  return class DynamoAdapter {
    constructor(readonly name: string) {}

    private key(id: string) {
      return { pk: `OIDC#${this.name}#${id}`, sk: "META" };
    }

    async upsert(id: string, payload: Payload, expiresIn?: number): Promise<void> {
      const exp = expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : undefined;
      await db.put({ ...this.key(id), payload, ...(exp ? { ttl: exp, exp } : {}) });
      if (payload.grantId) {
        await db.put({ pk: `OIDCG#${payload.grantId}`, sk: `${this.name}#${id}`, ...(exp ? { ttl: exp } : {}) });
      }
      if (payload.uid) await db.put({ pk: `OIDCUID#${payload.uid}`, sk: "META", id, name: this.name, ...(exp ? { ttl: exp } : {}) });
      if (payload.userCode) await db.put({ pk: `OIDCUC#${payload.userCode}`, sk: "META", id, ...(exp ? { ttl: exp } : {}) });
    }

    async find(id: string): Promise<Payload | undefined> {
      const r = await db.get<{ payload: Payload; exp?: number }>(this.key(id).pk, "META", true);
      if (!r) return undefined;
      if (r.exp && r.exp <= Math.floor(Date.now() / 1000)) return undefined;
      return r.payload;
    }

    async findByUid(uid: string): Promise<Payload | undefined> {
      const r = await db.get<{ id: string }>(`OIDCUID#${uid}`, "META", true);
      return r ? this.find(r.id) : undefined;
    }

    async findByUserCode(userCode: string): Promise<Payload | undefined> {
      const r = await db.get<{ id: string }>(`OIDCUC#${userCode}`, "META", true);
      return r ? this.find(r.id) : undefined;
    }

    async consume(id: string): Promise<void> {
      const { UpdateCommand } = await import("@aws-sdk/lib-dynamodb");
      await db.doc
        .send(
          new UpdateCommand({
            TableName: db.table,
            Key: this.key(id),
            UpdateExpression: "SET #p.#c = :now",
            ExpressionAttributeNames: { "#p": "payload", "#c": "consumed" },
            ExpressionAttributeValues: { ":now": Math.floor(Date.now() / 1000) },
            ConditionExpression: "attribute_exists(pk)",
          }),
        )
        .catch(() => undefined);
    }

    async destroy(id: string): Promise<void> {
      await db.delete(this.key(id).pk, "META");
    }

    async revokeByGrantId(grantId: string): Promise<void> {
      await revokeGrantRecords(db, grantId);
    }
  };
}

/** Delete every OAuth record (tokens, codes, the grant) that belongs to a grant. */
export async function revokeGrantRecords(db: Db, grantId: string): Promise<void> {
  const rows = await db.query(`OIDCG#${grantId}`);
  const keys = rows.map((r) => {
    const [name, ...rest] = r.sk.split("#");
    return { pk: `OIDC#${name}#${rest.join("#")}`, sk: "META" };
  });
  await db.deleteMany([...keys, ...rows.map((r) => ({ pk: r.pk, sk: r.sk })), { pk: `OIDC#Grant#${grantId}`, sk: "META" }]);
}
