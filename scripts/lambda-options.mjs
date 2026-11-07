// esbuild options for every Lambda bundle. Shared with services/auth/test/bundle.test.ts, which builds
// with exactly these options to prove the deployed bundle still works.
/**
 * @param {string} entry
 * @param {string} outfile
 * @returns {import("esbuild").BuildOptions}
 */
export function lambdaOptions(entry, outfile) {
  return {
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    minify: true,
    // node-oidc-provider uses class names as record kinds (Session, AuthorizationCode, ...);
    // minifying them away broke every live sign-in on 7 Nov 2026.
    keepNames: true,
    sourcemap: "inline",
    legalComments: "none",
    // Bundle the AWS SDK too, so the deployed code is exactly what was tested.
    external: [],
    // Some CommonJS dependencies call require(); give the ESM bundle one.
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
  };
}
