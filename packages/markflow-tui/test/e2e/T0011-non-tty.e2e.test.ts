// test/e2e/T0011-non-tty.e2e.test.ts
//
// T0011 — Non-TTY stdout prints a guidance message and exits non-zero;
// does not attempt to mount Ink.
// Refs: features.md §6.4.
//
// NOTE: This test intentionally uses execFile instead of the PTY harness
// because the whole point is to verify behavior when stdout is NOT a TTY.

import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BINARY = path.resolve(__dirname, "..", "..", "dist", "cli.js");

describe.skipIf(process.platform === "win32")(
  "T0011 non-TTY stdout",
  () => {
    test("prints guidance and exits non-zero without mounting Ink", async () => {
      const result = await new Promise<{
        code: number | null;
        stdout: string;
        stderr: string;
      }>((resolve) => {
        const child = execFile(
          "node",
          [BINARY],
          { timeout: 5_000 },
          (err, stdout, stderr) => {
            resolve({
              code: child.exitCode ?? (err as NodeJS.ErrnoException)?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? 1 : child.exitCode,
              stdout,
              stderr,
            });
          },
        );
      });

      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("interactive terminal");
      expect(result.stderr).toContain("markflow run");
      // Must NOT contain Ink's raw-mode error.
      expect(result.stderr).not.toContain("Raw mode is not supported");
    });
  },
);
