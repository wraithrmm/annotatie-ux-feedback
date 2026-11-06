// The token-signing key (ES256) and the cookie keys, generated in place on first start and kept in SSM
// (implementation-plan.md §6.2). Never in OpenTofu state or CI.
import { randomBytes } from "node:crypto";
import { exportJWK, generateKeyPair, importJWK, type JWK, type KeyLike } from "jose";
import { getOrCreateSecret, SECRET_NAMES } from "@annotatie/store";

export interface SigningKey {
  privateJwk: JWK & { kid: string };
  publicJwk: JWK & { kid: string };
  key: KeyLike | Uint8Array;
}

let cached: Promise<SigningKey> | undefined;

export function signingKey(): Promise<SigningKey> {
  cached ??= (async () => {
    const raw = await getOrCreateSecret(SECRET_NAMES.signingKey, async () => {
      const { privateKey } = await generateKeyPair("ES256", { extractable: true });
      const jwk = await exportJWK(privateKey);
      return JSON.stringify({ ...jwk, kid: `es256-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}`, alg: "ES256", use: "sig" });
    });
    const privateJwk = JSON.parse(raw) as JWK & { kid: string };
    const { d: _d, ...pub } = privateJwk;
    return { privateJwk, publicJwk: pub as JWK & { kid: string }, key: await importJWK(privateJwk, "ES256") };
  })();
  return cached;
}

export async function cookieKeys(): Promise<string[]> {
  const raw = await getOrCreateSecret(SECRET_NAMES.cookieKeys, () => JSON.stringify([randomBytes(32).toString("base64url"), randomBytes(32).toString("base64url")]));
  return JSON.parse(raw) as string[];
}
