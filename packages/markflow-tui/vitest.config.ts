import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.{test,spec}.{ts,tsx}"],
    exclude: [...configDefaults.exclude, "test/e2e/**"],
    globals: false,
    pool: "forks",
    restoreMocks: true,
  },
});
