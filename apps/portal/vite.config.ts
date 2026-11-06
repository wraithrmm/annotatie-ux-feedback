import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The portal is served at /board/ by CloudFront, which serves only /board/index.html for that folder:
// every screen is a hash route (#/attention, #/sites/<id>/items/<id>, ...), never a real path.
// `--mode e2e` (and `vite dev`) build the in-memory mock API in; a production build drops it entirely.
export default defineConfig({
  base: "/board/",
  root: fileURLToPath(new URL(".", import.meta.url)),
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    sourcemap: false,
  },
  preview: { port: 4173, strictPort: true },
  server: { port: 5173 },
});
