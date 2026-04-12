import { mkdtemp, rm, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseWorkflow,
  validateWorkflow,
  executeWorkflow,
} from "../core/index.js";
import type {
  WorkflowDefinition,
  StepResult,
  EngineEvent,
  BeforeStepDirective,
  ValidationDiagnostic,
} from "../core/types.js";

export interface MockResult {
  edge?: string;
  summary?: string;
  exitCode?: number;
  state?: Record<string, unknown>;
  global?: Record<string, unknown>;
}

export interface WorkflowTestRunOptions {
  inputs?: Record<string, string>;
  /** Called once after the per-run working directory is created, before execution. */
  workdirSetup?: (workdirPath: string) => Promise<void> | void;
  /** If true, the temp runsDir is not removed after the run. Path is surfaced on the result. */
  keepRunsDir?: boolean;
  parallel?: boolean;
}

export class WorkflowTestResult {
  constructor(
    public readonly status: "complete" | "error",
    public readonly steps: StepResult[],
    public readonly events: EngineEvent[],
    public readonly warnings: ValidationDiagnostic[],
    public readonly runsDir: string,
  ) {}

  get stepsRan(): string[] {
    return this.steps.map((s) => s.node);
  }

  callCount(nodeId: string): number {
    return this.steps.filter((s) => s.node === nodeId).length;
  }

  edgeTaken(nodeId: string, nth = 1): string {
    const match = this.steps.filter((s) => s.node === nodeId);
    if (match.length < nth) {
      throw new Error(
        `edgeTaken: node "${nodeId}" only fired ${match.length} time(s), cannot get call ${nth}`,
      );
    }
    return match[nth - 1].edge;
  }

  stepResult(nodeId: string, nth = 1): StepResult {
    const match = this.steps.filter((s) => s.node === nodeId);
    if (match.length < nth) {
      throw new Error(
        `stepResult: node "${nodeId}" only fired ${match.length} time(s), cannot get call ${nth}`,
      );
    }
    return match[nth - 1];
  }

  stepState(nodeId: string, nth = 1): Record<string, unknown> | undefined {
    return this.stepResult(nodeId, nth).state;
  }
}

/**
 * Test harness for workflows. Stubs step execution by edge/summary so tests
 * run fast without network or agent calls.
 *
 * Unmocked steps run for real. When an upstream script writes files that a
 * downstream step reads, seed the run workdir via `run({ workdirSetup })`.
 */
export class WorkflowTest {
  private mocks = new Map<string, MockResult[]>();
  private callCounters = new Map<string, number>();

  constructor(private readonly definition: WorkflowDefinition) {}

  /** Parse a workflow file and wrap it in a WorkflowTest. */
  static async fromFile(path: string): Promise<WorkflowTest> {
    const def = await parseWorkflow(path);
    return new WorkflowTest(def);
  }

  /**
   * Register a mock for a node.
   * - Single result → every call to this node returns it.
   * - Array → each call consumes the next entry; when the array is exhausted,
   *   the last entry is repeated.
   */
  mock(nodeId: string, result: MockResult | MockResult[]): this {
    const entries = Array.isArray(result) ? result : [result];
    if (entries.length === 0) {
      throw new Error(`mock: empty result array for node "${nodeId}"`);
    }
    this.mocks.set(nodeId, entries);
    return this;
  }

  async run(options: WorkflowTestRunOptions = {}): Promise<WorkflowTestResult> {
    const diagnostics = validateWorkflow(this.definition);
    const errors = diagnostics.filter((d) => d.severity === "error");
    const warnings = diagnostics.filter((d) => d.severity === "warning");
    if (errors.length > 0) {
      throw new Error(
        `Workflow has validation errors: ${errors.map((e) => e.message).join("; ")}`,
      );
    }

    const runsDir = await mkdtemp(join(tmpdir(), "markflow-test-"));

    this.callCounters.clear();
    const events: EngineEvent[] = [];
    let setupFired = false;

    try {
      const runInfo = await executeWorkflow(this.definition, {
        runsDir,
        inputs: options.inputs,
        config:
          options.parallel === undefined
            ? undefined
            : { parallel: options.parallel },
        onEvent: (e) => events.push(e),
        beforeStep: async (ctx) => {
          if (!setupFired) {
            setupFired = true;
            if (options.workdirSetup) {
              await options.workdirSetup(ctx.env.MARKFLOW_WORKDIR);
            }
          }

          const specs = this.mocks.get(ctx.nodeId);
          if (!specs) return; // unmocked → run for real

          const current = this.callCounters.get(ctx.nodeId) ?? 0;
          this.callCounters.set(ctx.nodeId, current + 1);
          const spec = specs[Math.min(current, specs.length - 1)];

          const directive: BeforeStepDirective = {
            edge: spec.edge ?? (ctx.step.type === "agent" ? "done" : "pass"),
            summary: spec.summary,
            exitCode: spec.exitCode,
            state: spec.state,
            global: spec.global,
          };
          return directive;
        },
      });

      return new WorkflowTestResult(
        runInfo.status === "complete" ? "complete" : "error",
        runInfo.steps,
        events,
        warnings,
        runsDir,
      );
    } finally {
      if (!options.keepRunsDir) {
        await rm(runsDir, { recursive: true, force: true });
      }
    }
  }
}

// Utility for tests that need to introspect run dirs
export async function listRunDirs(runsDir: string): Promise<string[]> {
  try {
    const entries = await readdir(runsDir);
    const dirs: string[] = [];
    for (const entry of entries) {
      const s = await stat(join(runsDir, entry));
      if (s.isDirectory()) dirs.push(entry);
    }
    return dirs;
  } catch {
    return [];
  }
}
