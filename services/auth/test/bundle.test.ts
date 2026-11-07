// The deployed auth bundle is minified. node-oidc-provider stores each record's kind from its class
// name, so a bundle that loses class names rejects every authorization code (live bug, 7 Nov 2026).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { lambdaOptions } from "../../../scripts/lambda-options.mjs";

describe("lambda bundle", () => {
  it("keeps the class names node-oidc-provider uses as record kinds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "annotatie-bundle-"));
    const entry = join(__dirname, "bundle-entry.tmp.mjs");
    writeFileSync(
      entry,
      'import Provider from "oidc-provider";\nconst p = new Provider("https://x.test", {});\n' +
        "export const kinds = [p.Session, p.Interaction, p.AuthorizationCode, p.AccessToken, p.RefreshToken, p.Grant].map((m) => m.name);\n",
    );
    try {
      const out = join(dir, "index.mjs");
      await build({ ...lambdaOptions(entry, out), sourcemap: false, logLevel: "error" });
      const { kinds } = await import(pathToFileURL(out).href);
      expect(kinds).toEqual(["Session", "Interaction", "AuthorizationCode", "AccessToken", "RefreshToken", "Grant"]);
    } finally {
      rmSync(entry, { force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
