import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    exclude: configDefaults.exclude,
    fileParallelism: false,
    maxWorkers: 1,
    pool: "forks",
    hookTimeout: 60_000,
    testTimeout: 60_000,
    sequence: {
      concurrent: false,
    },
  },
});
