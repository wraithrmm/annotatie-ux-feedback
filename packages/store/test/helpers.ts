// Tests run against DynamoDB Local: `docker run -d -p 8000:8000 amazon/dynamodb-local:2.5.3 -jar DynamoDBLocal.jar -inMemory -sharedDb`
// (CI starts it as a service container). DYNAMO_ENDPOINT defaults to http://localhost:8000.
import { CreateTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { Db } from "../src/db.js";
import { Service, type ServiceOptions } from "../src/service.js";
import type { AgentPrincipal, PersonPrincipal, WidgetPrincipal } from "../src/principal.js";
import type { AgentScope } from "@annotatie/core";

process.env.DYNAMO_ENDPOINT ??= "http://localhost:8000";
process.env.SECRETS_LOCAL = "1";

export const client = new DynamoDBClient({
  endpoint: process.env.DYNAMO_ENDPOINT,
  region: "eu-west-2",
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
});

export async function freshDb(): Promise<Db> {
  const table = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await client.send(
    new CreateTableCommand({
      TableName: table,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
    }),
  );
  return new Db(table, client);
}

export async function freshService(opts: Partial<ServiceOptions> = {}): Promise<Service> {
  return new Service(await freshDb(), { autoApproveAllowed: true, baseUrl: "https://annotatie.test", ...opts });
}

export async function person(svc: Service, name = "Riley Chen", email?: string): Promise<PersonPrincipal> {
  const userId = await svc.createUser(name, email ?? `${name.split(" ")[0]!.toLowerCase()}${Math.random().toString(36).slice(2, 6)}@example.com`);
  return { kind: "person", userId, name, via: { kind: "portal" } };
}

export function agentOf(
  p: PersonPrincipal,
  scopes: AgentScope[] = ["read", "reply", "reply:user", "status", "decide", "capture:read"],
  sites: string[] | null = null,
): AgentPrincipal {
  return { kind: "agent", userId: p.userId, name: p.name, sites, scopes: new Set(scopes), via: { kind: "agent", clientName: "Claude Code on TEST-PC" } };
}

export function widgetUser(siteId: string, userId = "host-user-1", name = "Sam Patel"): WidgetPrincipal {
  return { kind: "widget", siteId, userId, name };
}

export const page = { url: "https://shop.example.com/checkout", path: "/checkout", title: "Checkout" };
