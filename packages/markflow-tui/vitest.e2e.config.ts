import { defineConfig } from "vitest/config";

/**
 * Dedicated Vitest config for the Layer-3 node-pty E2E harness.
 *
 * Kept separate from the default `vitest.config.ts` so that the hermetic
 * unit/component test run (`npm test -w packages/markflow-tui`) never spawns
 * a PTY or loads `node-pty`. Invoked via `npm run test:e2e`.
 *
 * See docs/tui/plans/P9-T1.md §3.5.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/e2e/**/*.e2e.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    globals: false,
  },
});
