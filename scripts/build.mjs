// Builds everything the deployment needs into dist/:
//   dist/lambda/<service>/index.mjs   one bundle per Lambda (OpenTofu zips each folder)
//   dist/static/                      files served from the static bucket via CloudFront
//     board/                          the portal (apps/portal, Vite build)
//     sdk/v1/annotatie.js             the widget (packages/sdk-browser)
//     sdk/v1/annotatie-node.mjs       the Node SDK as one file (packages/sdk-server-node)
import { build } from "esbuild";
import { lambdaOptions } from "./lambda-options.mjs";
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });

const lambdas = ["api", "auth", "mcp", "jobs"].filter((n) => existsSync(`services/${n}/src/handler.ts`));
for (const name of lambdas) {
  await build(lambdaOptions(`services/${name}/src/handler.ts`, `dist/lambda/${name}/index.mjs`));
}

mkdirSync("dist/static", { recursive: true });

// The portal.
if (existsSync("apps/portal/vite.config.ts")) {
  execSync("npm run build -w @annotatie/portal", { stdio: "inherit" });
  cpSync("apps/portal/dist", "dist/static/board", { recursive: true });
} else {
  cpSync("apps/portal/public", "dist/static/board", { recursive: true });
}

// The widget, served (never bundled into a host site's own build).
if (existsSync("packages/sdk-browser/src/index.ts")) {
  await build({
    entryPoints: ["packages/sdk-browser/src/index.ts"],
    outfile: "dist/static/sdk/v1/annotatie.js",
    bundle: true,
    platform: "browser",
    target: ["es2020"],
    format: "iife",
    minify: true,
    legalComments: "none",
  });
}

// The Node SDK as one downloadable file (node:crypto only), for hosts to vendor into their repository:
// the install-sdk skill fetches it from /sdk/v1/annotatie-node.mjs.
if (existsSync("packages/sdk-server-node/src/index.ts")) {
  await build({
    entryPoints: ["packages/sdk-server-node/src/index.ts"],
    outfile: "dist/static/sdk/v1/annotatie-node.mjs",
    bundle: true,
    platform: "node",
    target: ["node20"],
    format: "esm",
    minify: false,
    legalComments: "none",
    banner: { js: "// @annotatie/sdk-server-node, v1 — https://annotatie.consulteasy.co.uk/sdk/v1/annotatie-node.mjs\n// Vendored copy: keep the private site key in your secrets store, never in a file in the repository." },
  });
}

writeFileSync(
  "dist/static/index.html",
  '<!doctype html><meta charset="utf-8"><title>Annotatie</title>' +
    '<meta http-equiv="refresh" content="0; url=/board/"><a href="/board/">Annotatie</a>\n',
);

console.log(`built ${lambdas.length} lambda(s) and static files into dist/`);
