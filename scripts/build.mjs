// Builds everything the deployment needs into dist/:
//   dist/lambda/<service>/index.mjs   one bundle per Lambda (OpenTofu zips each folder)
//   dist/static/                      files served from the static bucket via CloudFront
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });

const lambdas = ["api"];
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
    // The AWS SDK v3 is provided by the Lambda runtime.
    external: ["@aws-sdk/*"],
  });
}

mkdirSync("dist/static", { recursive: true });
cpSync("apps/portal/public", "dist/static/board", { recursive: true });
writeFileSync(
  "dist/static/index.html",
  '<!doctype html><meta charset="utf-8"><title>Annotatie</title>' +
    '<meta http-equiv="refresh" content="0; url=/board/"><a href="/board/">Annotatie</a>\n',
);

console.log(`built ${lambdas.length} lambda(s) and static files into dist/`);
