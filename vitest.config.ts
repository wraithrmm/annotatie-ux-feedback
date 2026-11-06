import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "services/*/test/**/*.test.ts",
      "apps/*/test/**/*.test.ts",
      "apps/*/test/**/*.test.tsx",
      "tools/*/test/**/*.test.ts",
    ],
    testTimeout: 20000,
  },
});
