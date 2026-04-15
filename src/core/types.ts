// ---- Workflow definition (parse output) ----

export interface InputDeclaration {
  name: string;
  required: boolean;
  default?: string;
  description: string;
}

export interface WorkflowDefinition {
  name: string;
  description: string;
  inputs: InputDeclaration[];
  graph: FlowGraph;
  steps: Map<string, StepDefinition>;
  sourceFile: string;
  configDefaults?: Partial<MarkflowConfig>;
  parserDiagnostics?: ValidationDiagnostic[];
}

export interface FlowGraph {
  nodes: Map<string, FlowNode>;
  edges: FlowEdge[];
}

export interface FlowNode {
  id: string;
  label?: string;
  shape?: string;
  isStart?: boolean;
}

export type EdgeStroke = "normal" | "thick" | "dotted";

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  stroke: EdgeStroke;
  annotations: EdgeAnnotations;
}

export interface EdgeAnnotations {
  maxRetries?: number;
  isExhaustionHandler?: boolean;
  exhaustionLabel?: string;
  forEach?: { key: string };
}

export type StepType = "script" | "agent" | "approval";
export type ScriptLang = "bash" | "sh" | "python" | "js" | "javascript";

export const SUPPORTED_LANGS: readonly string[] = [
  "bash",
  "sh",
  "python",
  "js",
  "javascript",
];

export interface StepAgentConfig {
  agent?: string;
  flags?: string[];
}

export type BackoffKind = "fixed" | "linear" | "exponential";

export interface RetryConfig {
  /** Maximum additional attempts after the initial run (total attempts = max + 1). */
  max: number;
  /** Base delay between attempts (duration string). Defaults to 0 (no delay). */
  delay?: string;
  /** Backoff curve. Defaults to "fixed". */
  backoff?: BackoffKind;
  /** Upper bound on a single computed delay. */
  maxDelay?: string;
  /** Jitter fraction in [0, 1]. 0 disables jitter. */
  jitter?: number;
}

export interface StepConfig {
  /** Human-readable duration (e.g. "30s", "5m", "1h30m") for this step's per-attempt timeout. */
  timeout?: string;
  /** Intrinsic retry policy applied when the step's resolved edge is "fail". */
  retry?: RetryConfig;
}

export interface StepApprovalConfig {
  prompt: string;
  options: string[];
}

export interface StepDefinition {
  id: string;
  type: StepType;
  lang?: ScriptLang;
  content: string;
  agentConfig?: StepAgentConfig;
  stepConfig?: StepConfig;
  approvalConfig?: StepApprovalConfig;
  line?: number;
}

// ---- Validation ----

export type Severity = "error" | "warning";

export interface ValidationDiagnostic {
  severity: Severity;
  message: string;
  nodeId?: string;
  line?: number;
  source?: string;
  suggestion?: string;
}

// ---- Configuration ----

export interface MarkflowConfig {
  agent: string;
  agentFlags: string[];
  maxRetriesDefault?: number;
  /** Default per-attempt step timeout (human-readable duration string). Applied when a step has no `timeout` of its own. */
  timeoutDefault?: string;
  parallel: boolean;
}

// ---- Execution / Runtime ----

export type TokenState = "pending" | "running" | "complete" | "skipped" | "waiting";

export interface Token {
  id: string;
  nodeId: string;
  generation: number;
  state: TokenState;
  edge?: string;
  result?: StepResult;
  batchId?: string;
  itemIndex?: number;
  parentTokenId?: string;
  itemContext?: unknown;
}

export interface StepResult {
  node: string;
  type: StepType;
  edge: string;
  summary: string;
  local?: Record<string, unknown>;
  started_at: string;
  completed_at: string;
  exit_code: number | null;
}

export type RunStatus = "running" | "complete" | "error" | "suspended";

export interface RunInfo {
  id: string;
  workflowName: string;
  sourceFile: string;
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
  steps: StepResult[];
}

export interface StepOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
  parsedResult?: {
    edge?: string;
    summary?: string;
    local?: Record<string, unknown>;
    global?: Record<string, unknown>;
    errors?: string[];
  };
}

// ---- Engine events ----

/**
 * Event payload shapes, without the `seq`/`ts` envelope.
 *
 * `EngineEvent` is `EngineEventPayload & { seq, ts }` — every persisted and
 * in-memory event carries a monotonic `seq` (per-run) and ISO-8601 `ts`.
 */
export type EngineEventPayload =
  | {
      type: "run:start";
      v: 1;
      workflowName: string;
      sourceFile: string;
      inputs: Record<string, string>;
      configResolved: MarkflowConfig;
    }
  | {
      type: "token:created";
      tokenId: string;
      nodeId: string;
      generation: number;
      parentTokenId?: string;
      batchId?: string;
      itemIndex?: number;
    }
  | {
      type: "token:state";
      tokenId: string;
      from: TokenState;
      to: TokenState;
    }
  | {
      type: "global:update";
      keys: string[];
      patch: Record<string, unknown>;
    }
  | {
      type: "output:ref";
      /** `seq` of the `step:start` this transcript belongs to. */
      stepSeq: number;
      tokenId: string;
      nodeId: string;
      stream: "stdout" | "stderr";
      path: string;
    }
  | { type: "step:start"; nodeId: string; tokenId: string }
  | {
      type: "step:output";
      nodeId: string;
      stream: "stdout" | "stderr";
      chunk: string;
    }
  | { type: "step:complete"; nodeId: string; tokenId: string; result: StepResult }
  | {
      type: "step:timeout";
      nodeId: string;
      tokenId: string;
      elapsedMs: number;
      limitMs: number;
    }
  | { type: "route"; from: string; to: string; edge?: string }
  | {
      type: "retry:increment";
      nodeId: string;
      label: string;
      count: number;
      max: number;
    }
  | { type: "retry:exhausted"; nodeId: string; label: string }
  | {
      type: "step:retry";
      nodeId: string;
      tokenId: string;
      /** 1-indexed attempt number that will run after the delay. */
      attempt: number;
      delayMs: number;
      reason: "fail" | "timeout";
    }
  | { type: "batch:start"; v: 1; batchId: string; nodeId: string; items: number }
  | { type: "batch:item:complete"; v: 1; batchId: string; itemIndex: number; tokenId: string }
  | { type: "batch:complete"; v: 1; batchId: string }
  | { type: "workflow:complete"; results: StepResult[] }
  | { type: "workflow:error"; error: string }
  | { type: "run:resumed"; v: 1; resumedAtSeq: number }
  | { type: "token:reset"; v: 1; tokenId: string }
  | {
      type: "step:waiting";
      v: 1;
      nodeId: string;
      tokenId: string;
      prompt: string;
      options: string[];
    }
  | {
      type: "approval:decided";
      v: 1;
      nodeId: string;
      tokenId: string;
      choice: string;
      decidedAt: string;
      decidedBy?: string;
    };

export type EngineEvent = EngineEventPayload & { seq: number; ts: string };

export type EngineEventType = EngineEventPayload["type"];

/**
 * Event types that are emitted in-memory only (never persisted to
 * `events.jsonl`). `step:output` produces kilobytes-to-megabytes of transcript
 * per step; transcripts live in sidecar files, not the event log.
 */
export const NON_PERSISTED_EVENT_TYPES: ReadonlySet<EngineEventType> = new Set([
  "step:output",
]);

export type EngineEventHandler = (event: EngineEvent) => void;

// ---- Engine snapshot (replay target) ----

/**
 * Data-only projection of engine state, sufficient to reconstruct a run from
 * its event log. Deliberately excludes non-serializable internals (child
 * processes, handler refs, file handles).
 */
export interface BatchState {
  nodeId: string;
  expected: number;
  completed: number;
}

export interface EngineSnapshot {
  tokens: Map<string, Token>;
  retryBudgets: Map<string, { count: number; max: number }>;
  globalContext: Record<string, unknown>;
  completedResults: StepResult[];
  status: RunStatus;
  batches: Map<string, BatchState>;
}

// ---- Event-log errors ----

export class UnsupportedLogVersionError extends Error {
  constructor(
    readonly version: unknown,
    readonly supported: readonly number[] = [1],
  ) {
    super(
      `Unsupported event log version: ${String(version)} (supported: ${supported.join(", ")})`,
    );
    this.name = "UnsupportedLogVersionError";
  }
}

export class InconsistentLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InconsistentLogError";
  }
}

export class TruncatedLogError extends Error {
  constructor(
    message: string,
    readonly byteOffset?: number,
  ) {
    super(message);
    this.name = "TruncatedLogError";
  }
}

// ---- Step interception (debugger / test harness) ----

export interface BeforeStepContext {
  nodeId: string;
  step: StepDefinition;
  /** 1-indexed; pre-incremented before the hook fires */
  callCount: number;
  /** Full environment passed to the step */
  env: Record<string, string>;
  /** Workflow inputs only (subset of env) */
  resolvedInputs: Record<string, string>;
  outgoingEdges: FlowEdge[];
  /** Retry counts for edges with budgets. count = retries already consumed before this invocation. */
  retryBudgets: Array<{ label: string; count: number; max: number }>;
  completedResults: StepResult[];
  globalContext: Record<string, unknown>;
  /** Pre-assembled prompt for agent steps; undefined for scripts */
  prompt?: string;
}

/**
 * Return void to run the step normally. Return a mock directive to
 * short-circuit execution and synthesize the StepResult directly.
 */
export type BeforeStepDirective =
  | void
  | {
      edge: string;
      summary?: string;
      exitCode?: number;
      local?: Record<string, unknown>;
      global?: Record<string, unknown>;
    };

export type BeforeStepHook = (
  ctx: BeforeStepContext,
) => Promise<BeforeStepDirective> | BeforeStepDirective;

export type StepOutputHandler = (
  stream: "stdout" | "stderr",
  chunk: string,
) => void;
