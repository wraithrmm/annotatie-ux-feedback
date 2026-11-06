// Passkey registration: JSON creation options from the server (base64url fields) -> navigator.credentials.create
// -> RegistrationResponseJSON for the server.

import { base64url, fromBase64url } from "./pkce";

type Json = Record<string, unknown>;

export function toCreationOptions(raw: Json): PublicKeyCredentialCreationOptions {
  const o = ((raw.publicKey as Json | undefined) ?? raw) as Json;
  const user = o.user as Json;
  const buf = (v: unknown) => fromBase64url(String(v)) as BufferSource;
  return {
    ...(o as unknown as PublicKeyCredentialCreationOptions),
    challenge: buf(o.challenge),
    user: { ...(user as unknown as PublicKeyCredentialUserEntity), id: buf(user.id) },
    excludeCredentials: ((o.excludeCredentials as Json[] | undefined) ?? []).map((c) => ({
      ...(c as unknown as PublicKeyCredentialDescriptor),
      id: buf(c.id),
    })),
  };
}

export function toRegistrationJSON(cred: PublicKeyCredential): Json {
  const r = cred.response as AuthenticatorAttestationResponse;
  const transports = typeof r.getTransports === "function" ? r.getTransports() : [];
  return {
    id: cred.id,
    rawId: base64url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: base64url(r.clientDataJSON),
      attestationObject: base64url(r.attestationObject),
      transports,
      ...(typeof r.getPublicKeyAlgorithm === "function" ? { publicKeyAlgorithm: r.getPublicKeyAlgorithm() } : {}),
      ...(typeof r.getPublicKey === "function" && r.getPublicKey() ? { publicKey: base64url(r.getPublicKey()!) } : {}),
      ...(typeof r.getAuthenticatorData === "function" ? { authenticatorData: base64url(r.getAuthenticatorData()) } : {}),
    },
    clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
  };
}

export async function createPasskey(options: Json): Promise<Json> {
  if (!("credentials" in navigator) || typeof PublicKeyCredential === "undefined") {
    throw new Error("This browser can't make passkeys.");
  }
  const cred = (await navigator.credentials.create({ publicKey: toCreationOptions(options) })) as PublicKeyCredential | null;
  if (!cred) throw new Error("No passkey was made.");
  return toRegistrationJSON(cred);
}
