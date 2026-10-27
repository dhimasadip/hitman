import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: [
      "apps/**/tests/**/*.test.ts",
      "packages/**/tests/**/*.test.ts",
      "spikes/**/tests/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["apps/*/src/**/*.ts", "packages/*/src/**/*.ts"],
    },
  },
});
