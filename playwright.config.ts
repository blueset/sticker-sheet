import { defineConfig, devices } from "@playwright/test";
import { BENCH_GPU_ARGS, benchGpu } from "./bench/harness.ts";

const STATIC_DIR = process.env.STATIC_DIR ?? "dist";
// BENCH_GPU=1: hardware GPU for the chromium projects (see bench/harness.ts).
const chromiumGpu = benchGpu() ? { launchOptions: { args: BENCH_GPU_ARGS } } : {};

export default defineConfig({
  testDir: ".",
  testMatch:
    process.env.BENCH === "1"
      ? ["tests/**/*.spec.ts", "bench/**/*.bench.ts"]
      : ["tests/**/*.spec.ts"],
  snapshotPathTemplate: "tests/visual/__snapshots__/{arg}{ext}",
  // Exact match unless a comparison run opts in (new build vs the recorded baseline), e.g. VISUAL_MAX_DIFF=0.01.
  expect: { toHaveScreenshot: { maxDiffPixelRatio: Number(process.env.VISUAL_MAX_DIFF ?? 0) } },
  // Benchmarks time the page, so they must never run in parallel.
  workers: process.env.BENCH === "1" ? 1 : undefined,
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
        ...chromiumGpu,
      },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 7"], ...chromiumGpu },
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
