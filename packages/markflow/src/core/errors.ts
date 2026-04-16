import type { ValidationDiagnostic } from "./types.js";

export class MarkflowError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MarkflowError";
    this.code = code;
  }
}

export class ParseError extends MarkflowError {
  constructor(message: string) {
    super("PARSE_ERROR", message);
    this.name = "ParseError";
  }
}

export class ValidationError extends MarkflowError {
  readonly diagnostics: ValidationDiagnostic[];

  constructor(message: string, diagnostics: ValidationDiagnostic[] = []) {
    super("VALIDATION_ERROR", message);
    this.name = "ValidationError";
    this.diagnostics = diagnostics;
  }

  static fromDiagnostics(diagnostics: ValidationDiagnostic[]): ValidationError {
    const errors = diagnostics.filter((d) => d.severity === "error");
    const message = `${errors.length} validation error(s): ${errors.map((e) => e.message).join("; ")}`;
    return new ValidationError(message, diagnostics);
  }
}

export class ExecutionError extends MarkflowError {
  constructor(message: string) {
    super("EXECUTION_ERROR", message);
    this.name = "ExecutionError";
  }
}

export class ConfigError extends MarkflowError {
  constructor(message: string) {
    super("CONFIG_ERROR", message);
    this.name = "ConfigError";
  }
}

export class TemplateError extends MarkflowError {
  constructor(message: string) {
    super("TEMPLATE_ERROR", message);
    this.name = "TemplateError";
  }
}

export class WorkflowAbortError extends MarkflowError {
  constructor() {
    super("ABORT", "Workflow aborted by debugger");
    this.name = "WorkflowAbortError";
  }
}

/**
 * Thrown when resuming an existing run against a workflow whose node set no
 * longer contains a replayed token's `nodeId`. Deeper semantic drift (changed
 * step logic) is out of scope — the user opted in by resuming.
 */
export class WorkflowChangedError extends MarkflowError {
  readonly missingNodeIds: string[];

  constructor(missingNodeIds: string[]) {
    super(
      "WORKFLOW_CHANGED",
      `Cannot resume: workflow no longer contains node(s) referenced by the run log: ${missingNodeIds.join(", ")}`,
    );
    this.name = "WorkflowChangedError";
    this.missingNodeIds = missingNodeIds;
  }
}

/**
 * Thrown by `openExistingRun` when another process (or another call in the
 * same process) already holds the exclusive on-disk lock at `runs/<id>/.lock`.
 * Callers surface this as a clean CLI message pointing at `lockPath` so a
 * stale lock can be removed manually.
 */
export class RunLockedError extends MarkflowError {
  readonly runId: string;
  readonly lockPath: string;
  readonly holderPid?: number;

  constructor(runId: string, lockPath: string, holderPid?: number) {
    const who = holderPid ? ` (held by pid ${holderPid})` : "";
    super("RUN_LOCKED", `Run ${runId} is already being resumed${who}`);
    this.name = "RunLockedError";
    this.runId = runId;
    this.lockPath = lockPath;
    this.holderPid = holderPid;
  }
}

/**
 * Thrown by `getSidecarStream` when the requested sidecar transcript file
 * cannot be located on disk. Distinguishes a "no such transcript" case
 * (missing `output/` directory, no file matching the seq prefix, or a seq
 * collision) from a generic Node `ENOENT`, so consumers can render a clean
 * "no output yet" state without inspecting `err.code`.
 */
export class SidecarNotFoundError extends Error {
  readonly runDir: string;
  readonly seq: number;
  readonly stream: "stdout" | "stderr";

  constructor(
    runDir: string,
    seq: number,
    stream: "stdout" | "stderr",
    reason: string,
  ) {
    super(
      `Sidecar not found: runDir=${runDir} seq=${seq} stream=${stream} (${reason})`,
    );
    this.name = "SidecarNotFoundError";
    this.runDir = runDir;
    this.seq = seq;
    this.stream = stream;
  }
}
