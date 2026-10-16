import { defineConfig, devices } from "@playwright/test";

const port = 4173;

export default defineConfig({
  testDir: "tests",
  testMatch: "*.spec.js", // tests/unit/*.test.mjs run under node --test
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${port}/lom-remastered-guide/`, trace: "retain-on-failure" },
  webServer: {
    command: `node tools/serve.mjs ${port}`,
    url: `http://127.0.0.1:${port}/lom-remastered-guide/`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
});
