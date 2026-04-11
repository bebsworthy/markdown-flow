// ---- Workflow definition (parse output) ----

export interface WorkflowDefinition {
  name: string;
  description: string;
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

export interface StepDefinition {
  id: string;
  type: StepType;
  lang?: ScriptLang;
  content: string;
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
  parsedResult?: { edge?: string; summary?: string };
}

// ---- Engine events ----

export type EngineEvent =
  | { type: "step:start"; nodeId: string; tokenId: string }
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
