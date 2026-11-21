import { defineConfig, devices } from "@playwright/test";

const STATIC_DIR = process.env.STATIC_DIR ?? "dist";

export default defineConfig({
  testDir: ".",
  testMatch:
    process.env.BENCH === "1"
      ? ["tests/**/*.spec.ts", "bench/**/*.bench.ts"]
      : ["tests/**/*.spec.ts"],
  snapshotPathTemplate: "tests/visual/__snapshots__/{arg}{ext}",
  use: {
    baseURL: "http://localhost:4173",
  },
  webServer: {
    command: `npx serve ${STATIC_DIR} -l 4173 --no-clipboard`,
    url: "http://localhost:4173",
    reuseExistingServer: true,
  },
  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "webkit-mobile",
      use: { ...devices["iPhone 14"] },
    },
    {
      name: "firefox-desktop",
      use: { ...devices["Desktop Firefox"] },
    },
  ],
});
