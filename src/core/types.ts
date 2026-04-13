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

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  annotations: EdgeAnnotations;
}

export interface EdgeAnnotations {
  maxRetries?: number;
  isExhaustionHandler?: boolean;
  exhaustionLabel?: string;
}

export type StepType = "script" | "agent";
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

export interface StepDefinition {
  id: string;
  type: StepType;
  lang?: ScriptLang;
  content: string;
  agentConfig?: StepAgentConfig;
}

// ---- Validation ----

export type Severity = "error" | "warning";

export interface ValidationDiagnostic {
  severity: Severity;
  message: string;
  nodeId?: string;
}

// ---- Configuration ----

export interface MarkflowConfig {
  agent: string;
  agentFlags: string[];
  maxRetriesDefault?: number;
  parallel: boolean;
}

// ---- Execution / Runtime ----

export type TokenState = "pending" | "running" | "complete" | "skipped";

export interface Token {
  id: string;
  nodeId: string;
  generation: number;
  state: TokenState;
  edge?: string;
  result?: StepResult;
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

export type RunStatus = "running" | "complete" | "error";

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

export type EngineEvent =
  | { type: "step:start"; nodeId: string; tokenId: string }
  | {
      type: "step:output";
      nodeId: string;
      stream: "stdout" | "stderr";
      chunk: string;
    }
  | { type: "step:complete"; nodeId: string; result: StepResult }
  | { type: "route"; from: string; to: string; edge?: string }
  | {
      type: "retry:increment";
      nodeId: string;
      label: string;
      count: number;
      max: number;
    }
  | { type: "retry:exhausted"; nodeId: string; label: string }
  | { type: "workflow:complete"; results: StepResult[] }
  | { type: "workflow:error"; error: string };

export type EngineEventHandler = (event: EngineEvent) => void;

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
