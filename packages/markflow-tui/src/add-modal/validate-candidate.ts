// src/add-modal/validate-candidate.ts
//
// Validator for add-modal candidates (P4-T3).
//
// Authoritative references:
//   - docs/tui/plans/P4-T3.md §5.4.
//
// Imports node:fs/promises, node:path, and the engine's parseWorkflow.
// NOT pure; NOT listed in test/state/purity.test.ts::files[].

import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import { parseWorkflow, validateWorkflow } from "markflow-cli";
import type { Candidate, ValidationResult } from "./types.js";

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

async function validateFile(absolutePath: string): Promise<ValidationResult> {
  try {
    await stat(absolutePath);
  } catch (err) {
    return {
      kind: "file-parse-error",
      message: errorMessage(err),
    };
  }
  try {
    const workflow = await parseWorkflow(absolutePath);
    // Parse succeeded. We don't promote validator diagnostics to
    // "parse-error" here — the badge in the modal only reflects PARSE
    // success (structural soundness). Full validation errors are shown in
    // the preview pane once the user has added the entry, matching the
    // resolver's P4-T2 behaviour for valid parses.
    void validateWorkflow(workflow);
    return { kind: "file-valid" };
  } catch (err) {
    return {
      kind: "file-parse-error",
      message: errorMessage(err),
    };
  }
}

interface MarkflowJsonLoose {
  readonly workflow?: unknown;
  readonly workflowPath?: unknown;
}

async function readConfigWorkflowPath(
  workspacePath: string,
): Promise<{ path: string | null; error: string | null }> {
  const configPath = join(workspacePath, ".markflow.json");
  try {
    const raw = await readFile(configPath, "utf8");
    try {
      const parsed = JSON.parse(raw) as MarkflowJsonLoose;
      // Engine writes `workflow`; older resolver wrote `workflowPath`.
      // Accept either for compatibility; prefer `workflow` when both are present.
      const rel =
        typeof parsed.workflow === "string"
          ? parsed.workflow
          : typeof parsed.workflowPath === "string"
            ? parsed.workflowPath
            : null;
      if (rel === null) {
        return {
          path: null,
          error: ".markflow.json is missing the \"workflow\" key",
        };
      }
      return { path: resolvePath(workspacePath, rel), error: null };
    } catch (err) {
      return {
        path: null,
        error: `.markflow.json is not valid JSON: ${errorMessage(err)}`,
      };
    }
  } catch (err) {
    if (err && typeof err === "object" && "code" in err) {
      const code = (err as { code: unknown }).code;
      if (code === "ENOENT") return { path: null, error: null };
    }
    return { path: null, error: errorMessage(err) };
  }
}

async function findFallbackMd(workspacePath: string): Promise<string | null> {
  try {
    const entries = await readdir(workspacePath);
    const md = entries.find((f) => /\.md$/i.test(f));
    return md ? join(workspacePath, md) : null;
  } catch {
    return null;
  }
}

async function validateWorkspace(
  workspacePath: string,
): Promise<ValidationResult> {
  const { path: configPath, error: configError } =
    await readConfigWorkflowPath(workspacePath);
  if (configError !== null) {
    return { kind: "workspace-invalid", message: configError };
  }

  let workflowFile = configPath;
  if (workflowFile === null) {
    workflowFile = await findFallbackMd(workspacePath);
  }

  if (workflowFile === null) {
    return {
      kind: "workspace-invalid",
      message: "Workspace has no .markflow.json and no *.md file",
    };
  }

  try {
    const workflow = await parseWorkflow(workflowFile);
    void validateWorkflow(workflow);
    return { kind: "workspace" };
  } catch (err) {
    return {
      kind: "workspace-invalid",
      message: errorMessage(err),
    };
  }
}

/**
 * Classify a candidate for visual display in the modal. Contract: NEVER
 * throws; every failure is mapped onto a `ValidationResult` variant. The
 * caller is responsible for de-duplicating calls (e.g. via a `Map<path, …>`).
 */
export async function validateCandidate(
  c: Candidate,
): Promise<ValidationResult> {
  if (c.kind === "file") return validateFile(c.absolutePath);
  return validateWorkspace(c.absolutePath);
}
