import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    globalSetup: ["./src/inline/test-bundles.setup.ts"],
    include: [
      "src/**/*.test.ts",
      "bench/**/*.test.ts",
      "scripts/**/*.test.ts",
      "proto/**/*.test.ts",
    ],
  },
});
