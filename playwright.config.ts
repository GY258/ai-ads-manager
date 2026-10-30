import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "runs/playwright",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  use: { baseURL: external ?? `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } } }],
  webServer: external
    ? undefined
    : {
        command: `rm -rf runs/e2e && pnpm next start -p ${PORT}`,
        url: `http://localhost:${PORT}/api/health`,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          AI_MODE: "mock",
          DB_DRIVER: "pglite",
          PGLITE_DIR: "runs/e2e/db",
          STORAGE_DRIVER: "local",
          LOCAL_STORAGE_DIR: "runs/e2e/storage",
          MOCK_IMAGE_DELAY_MS: "400",
          ENABLE_TEST_HOOKS: "1",
        },
      },
});
