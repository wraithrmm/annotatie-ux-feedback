// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { base64url, challengeS256, fromBase64url, makeVerifier } from "../src/pkce";

describe("PKCE", () => {
  it("matches the RFC 7636 appendix B example", async () => {
    expect(await challengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("makes 43-character base64url verifiers, different each time", () => {
    const a = makeVerifier();
    const b = makeVerifier();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("round-trips base64url without padding", () => {
    const bytes = new Uint8Array([0, 251, 255, 1, 2]);
    const s = base64url(bytes);
    expect(s).not.toMatch(/[=+/]/);
    expect([...fromBase64url(s)]).toEqual([...bytes]);
  });
});
