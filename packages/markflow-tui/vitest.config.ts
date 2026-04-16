import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.{test,spec}.{ts,tsx}"],
    globals: false,
    pool: "forks",
    restoreMocks: true,
  },
});
