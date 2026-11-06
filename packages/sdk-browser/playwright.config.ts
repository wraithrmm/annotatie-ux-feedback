// The widget's end-to-end specs: the fixture host (e2e/fixture-host) with the widget on it, talking to the
// in-memory mock API (e2e/mock-api.mjs), in Chromium at 390×844 and 1280×800.
// A fresh Ed25519 site key is made for each run and handed to both servers; nothing is stored.
import { createHash, generateKeyPairSync } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

const HOST_PORT = 4310;
const API_PORT = 4311;

function siteKey() {
  if (process.env.E2E_SITE_KEY) return JSON.parse(process.env.E2E_SITE_KEY) as { pem: string; jwk: string; kid: string };
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const x = (publicKey.export({ format: "jwk" }) as { x: string }).x;
  const jwk = JSON.stringify({ kty: "OKP", crv: "Ed25519", x });
  const kid = createHash("sha256").update(JSON.stringify({ crv: "Ed25519", kty: "OKP", x })).digest("base64url");
  const key = { pem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(), jwk, kid };
  // Workers load this file again: they must see the same key as the servers started by the runner.
  process.env.E2E_SITE_KEY = JSON.stringify(key);
  return key;
}
const key = siteKey();

export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${HOST_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "phone-390", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: false } },
    { name: "desktop-1280", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: [
    {
      command: "node e2e/mock-api.mjs",
      url: `http://127.0.0.1:${API_PORT}/__test/state`,
      reuseExistingServer: false,
      stdout: "pipe",
      env: {
        MOCK_PORT: String(API_PORT),
        ALLOWED_ORIGIN: `http://127.0.0.1:${HOST_PORT}`,
        ANNOTATIE_SITE_ID: "site_fixture",
        SITE_PUBLIC_JWK: key.jwk,
      },
    },
    {
      command: "node e2e/fixture-host/server.mjs",
      url: `http://127.0.0.1:${HOST_PORT}/`,
      reuseExistingServer: false,
      stdout: "pipe",
      env: {
        PORT: String(HOST_PORT),
        ANNOTATIE_BASE: `http://127.0.0.1:${API_PORT}`,
        ANNOTATIE_SITE_ID: "site_fixture",
        ANNOTATIE_KID: key.kid,
        ANNOTATIE_PRIVATE_KEY_PEM: key.pem,
      },
    },
  ],
});
