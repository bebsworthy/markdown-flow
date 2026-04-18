// test/e2e/T0906-sigwinch-resize.e2e.test.ts
//
// T0906 — A terminal resize event (SIGWINCH) re-computes tiers live;
// the keybar switches from "full" to "short" mid-session without a
// restart.
// Refs: features.md §6.2.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import { DEFAULT_READY_MS, spawnTui, type TuiSession } from "./harness.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE = path.resolve(__dirname, "fixtures", "hello.md");

describe.skipIf(process.platform === "win32")(
  "T0906 SIGWINCH resize recomputes keybar tiers",
  () => {
    let session: TuiSession | undefined;

    afterEach(async () => {
      if (session) {
        await session.kill();
        session = undefined;
      }
    });

    test("resize from full to short tier updates keybar live", async () => {
      // Start at full tier (≥100 cols)
      session = await spawnTui({ cols: 140, rows: 30, args: [FIXTURE] });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      // Full tier should show labels in the keybar (last line)
      let snap = session.snapshot();
      let lines = snap.split("\n");
      let keybar = lines[lines.length - 1] ?? "";
      expect(keybar).toContain("Select");
      expect(keybar).toContain("Open");

      // Resize to short tier (60–100 cols)
      session.resize(80, 30);
      // Wait for the keybar to drop labels (short tier shows keys only)
      await session.waitFor(() => {
        const s = session!.snapshot();
        const ls = s.split("\n");
        const kb = ls[ls.length - 1] ?? "";
        return !kb.includes("Select");
      }, DEFAULT_READY_MS);

      snap = session.snapshot();
      lines = snap.split("\n");
      keybar = lines[lines.length - 1] ?? "";
      expect(keybar).not.toContain("Select");
      expect(keybar).toMatch(/↑↓/);
    });
  },
);
