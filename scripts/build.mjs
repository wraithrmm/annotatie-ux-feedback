// Builds everything the deployment needs into dist/:
//   dist/lambda/<service>/index.mjs   one bundle per Lambda (OpenTofu zips each folder)
//   dist/static/                      files served from the static bucket via CloudFront
//     board/                          the portal (apps/portal, Vite build)
//     sdk/v1/annotatie.js             the widget (packages/sdk-browser)
import { build } from "esbuild";
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });

const lambdas = ["api", "auth", "mcp", "jobs"].filter((n) => existsSync(`services/${n}/src/handler.ts`));
for (const name of lambdas) {
  await build({
    entryPoints: [`services/${name}/src/handler.ts`],
    outfile: `dist/lambda/${name}/index.mjs`,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    minify: true,
    sourcemap: "inline",
    legalComments: "none",
    // Bundle the AWS SDK too, so the deployed code is exactly what was tested.
    external: [],
    // Some CommonJS dependencies call require(); give the ESM bundle one.
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
  });
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

writeFileSync(
  "dist/static/index.html",
  '<!doctype html><meta charset="utf-8"><title>Annotatie</title>' +
    '<meta http-equiv="refresh" content="0; url=/board/"><a href="/board/">Annotatie</a>\n',
);

console.log(`built ${lambdas.length} lambda(s) and static files into dist/`);
