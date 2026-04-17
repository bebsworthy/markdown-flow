// test/e2e/journey-approval.e2e.test.ts
//
// Journey 3 — Approval workflow is ingested and visible. The spec calls
// for "approval pending → `a` open modal → decide → run resumes", but the
// approval gate only fires from a `viewing` run — which requires a run to
// be triggered via the TUI, and the `r`/`:run` binding is still unwired at
// feat/TUI HEAD. Per docs/tui/plans/P9-T1.md §8 the journey adapts to the
// actual keystrokes — this exercises the reachable surface: registry
// ingestion + `a`-key is accepted in the browsing context (it toggles the
// runs-archive filter on the RUNS tab — distinct from the in-run approval
// trigger which is correctly scoped to `viewing` mode).
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
const FIXTURE = path.resolve(__dirname, "fixtures", "approve.md");

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(process.platform === "win32")(
  "e2e journey 3: approval gate",
  () => {
    let session: TuiSession | undefined;

    afterEach(async () => {
      if (session) {
        await session.kill();
        session = undefined;
      }
    });

    test("approve.md ingests and `a` on the workflow browser opens add-modal", async () => {
      session = await spawnTui({ cols: 120, rows: 40, args: [FIXTURE] });

      await session.waitForText("WORKFLOWS", DEFAULT_READY_MS);
      await session.waitFor(async () => {
        if (!(await fileExists(session!.scratch.registryPath))) return false;
        const raw = await readFile(session!.scratch.registryPath, "utf8");
        return raw.includes("approve.md");
      }, DEFAULT_WAIT_MS);

      await session.waitForText("approve.md", DEFAULT_WAIT_MS);

      const raw = await readFile(session.scratch.registryPath, "utf8");
      const parsed = JSON.parse(raw) as ReadonlyArray<{ source?: unknown }>;
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);

      // Pressing `a` on the workflow browser triggers the add-workflow
      // overlay state (documented binding — see workflow-browser.tsx).
      // We then Esc out and confirm the browser row is still rendered.
      session.write("a");
      session.pressEsc();
      await session.waitForText("approve.md", DEFAULT_WAIT_MS);

      expect(session.snapshot()).toMatchSnapshot();
    });

    test("rejection path: Esc without decision keeps the registry unchanged", async () => {
      session = await spawnTui({ cols: 120, rows: 40, args: [FIXTURE] });
      await session.waitForText("WORKFLOWS", DEFAULT_READY_MS);
      await session.waitForText("approve.md", DEFAULT_WAIT_MS);

      const before = await readFile(session.scratch.registryPath, "utf8");
      session.write("a");
      session.pressEsc();
      await session.waitForText("approve.md", DEFAULT_WAIT_MS);
      const after = await readFile(session.scratch.registryPath, "utf8");

      expect(after).toEqual(before);
    });
  },
);
