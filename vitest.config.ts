import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["services/*/test/**/*.test.ts", "tools/*/test/**/*.test.ts"],
  },
});
