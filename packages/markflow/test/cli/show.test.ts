import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseWorkflowFromString,
  executeWorkflow,
} from "../../src/core/index.js";
import { showCommand } from "../../src/cli/commands/show.js";

const FIXTURES = join(import.meta.dirname, "../fixtures");

function captureStdout(fn: () => Promise<void>): Promise<string> {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  const stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);
  return fn().then(() => {
    const logOut = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    const writeOut = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    spy.mockRestore();
    stdoutSpy.mockRestore();
    return logOut + (writeOut ? "\n" + writeOut : "");
  });
}

describe("markflow show: --events and --output", () => {
  let runsDir: string;
  let runId: string;

  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), "markflow-show-"));
    const def = parseWorkflowFromString(
      readFileSync(join(FIXTURES, "linear.md"), "utf-8"),
    );
    const runInfo = await executeWorkflow(def, { runsDir });
    runId = runInfo.id;
  });

  it("--events dumps the raw event timeline", async () => {
    const output = await captureStdout(() =>
      showCommand(runId, { runsDir, events: true }),
    );
    expect(output).toContain("run:start");
    expect(output).toContain("step:complete");
    expect(output).toMatch(/\[0001\]/);
  });

  it("--events --json emits a JSON array of events", async () => {
    const output = await captureStdout(() =>
      showCommand(runId, { runsDir, events: true, json: true }),
    );
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].type).toBe("run:start");
    expect(parsed[0].seq).toBe(1);
  });

  it("--output <seq> prints the sidecar transcript for that step:start", async () => {
    const { readEventLog } = await import("../../src/core/replay.js");
    const events = await readEventLog(join(runsDir, runId));
    const starts = events.filter((e) => e.type === "step:start");
    expect(starts.length).toBeGreaterThan(0);
    const targetSeq = starts[0].seq;

    const output = await captureStdout(() =>
      showCommand(runId, { runsDir, output: targetSeq }),
    );
    // Sidecar header + content; linear fixture's setup step echoes something.
    expect(output).toContain("stdout");
  });
});
