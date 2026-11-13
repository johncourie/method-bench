import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5184", viewport: { width: 1280, height: 900 } },
  webServer: { command: "npm run build && npm run preview", url: "http://localhost:5184", reuseExistingServer: true, timeout: 120_000 },
});
