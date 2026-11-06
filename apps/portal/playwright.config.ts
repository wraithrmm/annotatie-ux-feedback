import { defineConfig, devices } from "@playwright/test";

// The portal against `vite preview` of an e2e build, with the in-memory mock (?mock=1).
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "phone", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: "npm run build:e2e && npx vite preview --config vite.config.ts --outDir dist-e2e --port 4173 --strictPort",
    url: "http://localhost:4173/board/",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
