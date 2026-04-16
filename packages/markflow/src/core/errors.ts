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
