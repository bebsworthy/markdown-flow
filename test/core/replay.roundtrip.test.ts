import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseWorkflowFromString,
  WorkflowEngine,
} from "../../src/core/index.js";
import { replay, readEventLog } from "../../src/core/replay.js";
import type { EngineSnapshot } from "../../src/core/types.js";

const FIXTURES = join(import.meta.dirname, "../fixtures");

const CASES: Array<{ name: string; file: string; inputs?: Record<string, string> }> = [
  { name: "linear", file: "linear.md" },
  { name: "parallel", file: "parallel.md" },
  { name: "branch", file: "branch.md" },
  { name: "retry-step-config", file: "retry-step-config.md" },
];

describe("replay round-trip", () => {
  let tempRunsDir: string;

  beforeEach(async () => {
    tempRunsDir = await mkdtemp(join(tmpdir(), "markflow-rt-"));
  });

  it.each(CASES)("$name: replay(log) deep-equals live snapshot", async ({ file, inputs }) => {
    const def = parseWorkflowFromString(
      readFileSync(join(FIXTURES, file), "utf-8"),
    );
    const engine = new WorkflowEngine(def, { runsDir: tempRunsDir, inputs });
    const runInfo = await engine.start();

    const liveSnapshot = engine.getSnapshot();
    const events = await readEventLog(join(tempRunsDir, runInfo.id));
    const replayed = replay(events);

    expect(replayed).toEqual(liveSnapshot);
  });

  it("intermediate snapshots match at each step:complete", async () => {
    const def = parseWorkflowFromString(
      readFileSync(join(FIXTURES, "linear.md"), "utf-8"),
    );

    const checkpoints: EngineSnapshot[] = [];
    const engine = new WorkflowEngine(def, {
      runsDir: tempRunsDir,
      onEvent: (e) => {
        if (e.type === "step:complete") {
          checkpoints.push(engine.getSnapshot());
        }
      },
    });
    const runInfo = await engine.start();

    const events = await readEventLog(join(tempRunsDir, runInfo.id));
    // Reconstruct at each step:complete seq and compare against the live
    // checkpoint captured at that moment.
    const completeSeqs = events
      .filter((e) => e.type === "step:complete")
      .map((e) => e.seq);
    expect(completeSeqs).toHaveLength(checkpoints.length);
    expect(completeSeqs.length).toBeGreaterThan(0);

    for (let i = 0; i < completeSeqs.length; i++) {
      const upTo = events.filter((e) => e.seq <= completeSeqs[i]);
      const replayed = replay(upTo);
      const live = checkpoints[i];
      expect(replayed.completedResults).toEqual(live.completedResults);
      expect(replayed.globalContext).toEqual(live.globalContext);
    }
  });

  it("exercises every persisted EngineEvent variant across the fixture suite", async () => {
    const seen = new Set<string>();
    // Inline edge-retry fixture to force `retry:increment` emission; the
    // bundled retry.md scripts all succeed so they never route via `fail`.
    const edgeRetrySource = `# Edge Retry

# Flow

\`\`\`mermaid
flowchart TD
  test([run]) -->|pass| done
  test -->|fail max:2| test
  test -->|fail:max| abort
\`\`\`

# Steps

## test

\`\`\`bash
exit 1
\`\`\`

## done

\`\`\`bash
echo done
\`\`\`

## abort

\`\`\`bash
echo abort
\`\`\`
`;
    const sources = [
      ...CASES.map((c) => readFileSync(join(FIXTURES, c.file), "utf-8")),
      edgeRetrySource,
    ];
    for (const src of sources) {
      const def = parseWorkflowFromString(src);
      const runInfo = await new WorkflowEngine(def, {
        runsDir: tempRunsDir,
      }).start();
      const events = await readEventLog(join(tempRunsDir, runInfo.id));
      for (const e of events) seen.add(e.type);
    }
    // Core variants must all appear across the combined fixtures.
    for (const required of [
      "run:start",
      "token:created",
      "token:state",
      "step:start",
      "step:complete",
      "output:ref",
      "route",
      "retry:increment",
      "workflow:complete",
    ]) {
      expect(seen.has(required), `missing variant ${required}`).toBe(true);
    }
  });
});
