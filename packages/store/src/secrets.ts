// Secrets generated in place and kept in SSM Parameter Store (SecureString, standard tier): never in
// OpenTofu state, never in CI (implementation-plan.md §6.2). First caller creates; everyone else reads.
import { GetParameterCommand, ParameterAlreadyExists, ParameterNotFound, PutParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

const cache = new Map<string, string>();
const local = new Map<string, string>();
let ssm: SSMClient | undefined;

/** Read a secret; if it is missing, create it with `make()` (conditional write) and read it back. */
export async function getOrCreateSecret(name: string, make: () => string | Promise<string>): Promise<string> {
  const hit = cache.get(name);
  if (hit) return hit;
  if (process.env.SECRETS_LOCAL === "1") {
    if (!local.has(name)) local.set(name, await make());
    const v = local.get(name)!;
    cache.set(name, v);
    return v;
  }
  ssm ??= new SSMClient({});
  const read = async () => (await ssm!.send(new GetParameterCommand({ Name: name, WithDecryption: true }))).Parameter?.Value;
  let value: string | undefined;
  try {
    value = await read();
  } catch (e) {
    if (!(e instanceof ParameterNotFound) && (e as { name?: string }).name !== "ParameterNotFound") throw e;
  }
  if (!value) {
    try {
      await ssm.send(new PutParameterCommand({ Name: name, Type: "SecureString", Tier: "Standard", Overwrite: false, Value: await make() }));
    } catch (e) {
      if (!(e instanceof ParameterAlreadyExists) && (e as { name?: string }).name !== "ParameterAlreadyExists") throw e;
    }
    value = await read();
  }
  if (!value) throw new Error(`secret ${name} could not be read`);
  cache.set(name, value);
  return value;
}

export const SECRET_NAMES = {
  signingKey: "/annotatie/auth/signing-jwk",
  cookieKeys: "/annotatie/auth/cookie-keys",
  vapid: "/annotatie/auth/vapid",
} as const;
