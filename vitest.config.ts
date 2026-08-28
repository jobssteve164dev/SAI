import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["packages/**/*.ts", "apps/**/*.ts"],
      provider: "v8",
    },
    include: ["tests/**/*.test.ts"],
    maxWorkers: 2,
    testTimeout: 15_000,
  },
});
