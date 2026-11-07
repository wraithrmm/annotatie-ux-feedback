// The API Lambda (docs/api.md). Configuration from the environment set by OpenTofu.
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { Db, jwksFor, makePushNotifier, readSecret, SECRET_NAMES, Service, vapidKeys } from "@annotatie/store";
import { createApp, type SelfSite } from "./app.js";
import { s3Captures } from "./captures.js";

const baseUrl = process.env.ANNOTATIE_BASE_URL ?? "https://annotatie.consulteasy.co.uk";
let app: ReturnType<typeof createApp> | undefined;

function init() {
  const db = new Db(process.env.TABLE_NAME ?? "annotatie-data");
  const svc: Service = new Service(db, {
    autoApproveAllowed: process.env.AUTO_APPROVE_ALLOWED !== "false",
    baseUrl,
    notify: (e) => makePushNotifier(() => svc, baseUrl)(e),
  });
  return createApp({
    svc,
    captures: s3Captures(process.env.CAPTURE_BUCKET ?? ""),
    baseUrl,
    keys: jwksFor(baseUrl),
    vapidPublicKey: async () => (await vapidKeys()).publicKey,
    buildSha: process.env.BUILD_SHA ?? "dev",
    selfSite: async () => {
      const raw = await readSecret(SECRET_NAMES.selfSite);
      return raw ? (JSON.parse(raw) as SelfSite) : undefined;
    },
  });
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  app ??= init();
  return app(event);
}
