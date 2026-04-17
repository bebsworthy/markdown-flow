// test/e2e/journey-add-run.e2e.test.ts
//
// Journey 1 — Empty launch → add a workflow by path → observe it land in
// the on-disk registry. The "run" leg uses the `markflow-tui <path>`
// launch-arg ingestion documented in the onboarding screen
//   "or relaunch:  markflow-tui <path|glob|url>"
// because the in-TUI `r`-to-run binding is still a TODO at feat/TUI HEAD
// (packages/markflow-tui/src/components/workflow-browser.tsx line 156 —
// `if (input === "r") return;`). Per docs/tui/plans/P9-T1.md §8, journeys
// "adjust to the actual keystrokes — no spec change needed".
//
// See docs/tui/plans/P9-T1.md §3.4 / §8.

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import {
  DEFAULT_READY_MS,
  DEFAULT_WAIT_MS,
  spawnTui,
  type TuiSession,
} from "./harness.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE = path.resolve(__dirname, "fixtures", "hello.md");

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(process.platform === "win32")(
  "e2e journey 1: add → run",
  () => {
    let session: TuiSession | undefined;

    afterEach(async () => {
      if (session) {
        await session.kill();
        session = undefined;
      }
    });

    test("empty launch surfaces the onboarding copy", async () => {
      session = await spawnTui({ cols: 120, rows: 40 });
      await session.waitForText("WORKFLOWS", DEFAULT_READY_MS);
      const snap = session.snapshot();
      expect(snap).toContain("WORKFLOWS");
      expect(snap).toContain("No workflows registered yet");
      expect(snap).toContain("Press  a  to add");
    });

    test(
      "launch-arg ingestion persists workflow to registry and renders it",
      async () => {
        session = await spawnTui({ cols: 120, rows: 40, args: [FIXTURE] });

        await session.waitForText("WORKFLOWS", DEFAULT_READY_MS);

        // Readiness: registry file written with our fixture.
        await session.waitFor(async () => {
          if (!(await fileExists(session!.scratch.registryPath))) return false;
          const raw = await readFile(session!.scratch.registryPath, "utf8");
          return raw.includes("hello.md");
        }, DEFAULT_WAIT_MS);

        const raw = await readFile(session.scratch.registryPath, "utf8");
        const parsed = JSON.parse(raw) as ReadonlyArray<{
          source?: unknown;
          addedAt?: unknown;
        }>;
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.length).toBeGreaterThan(0);
        expect(typeof parsed[0]?.source).toBe("string");

        // And the browser view renders the workflow row.
        await session.waitForText("hello.md", DEFAULT_WAIT_MS);

        // One canonical-view snapshot at the terminal state (plan §3.2).
        expect(session.snapshot()).toMatchSnapshot();
      },
    );
  },
);
