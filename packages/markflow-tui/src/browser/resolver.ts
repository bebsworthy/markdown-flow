// src/browser/resolver.ts
//
// Async resolver: turns `RegistryEntry[]` into `ResolvedEntry[]` by
// stat-ing the path, parsing if it's an .md file, reading the
// `.markflow.json` if it's a workspace dir, and querying last-run
// info. Never throws — every failure becomes a structured `ResolvedEntry`.
//
// Authoritative references:
//   - docs/tui/features.md §3.1
//   - docs/tui/plans/P4-T2.md §2.4

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve as resolvePath } from "node:path";
import {
  createRunManager,
  parseWorkflow,
  validateWorkflow,
  type RunInfo,
  type ValidationDiagnostic,
  type WorkflowDefinition,
} from "markflow";
import { formatEntryId } from "./preview-layout.js";
import type {
  EntrySourceKind,
  LastRunInfo,
  ResolvedEntry,
  ResolverOptions,
} from "./types.js";
import type { RegistryEntry } from "../registry/types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function resolveEntry(
  entry: RegistryEntry,
  opts: ResolverOptions,
): Promise<ResolvedEntry> {
  const absolutePath = resolvePath(opts.baseDir, entry.source);
  const id = formatEntryId(entry);

  // (1) stat the path.
  let st;
  try {
    st = await stat(absolutePath);
  } catch (err) {
    const reason = classifyStatError(err);
    return {
      entry,
      id,
      sourceKind: "file",
      absolutePath: null,
      status: "missing",
      title: basename(entry.source) || entry.source,
      workflow: null,
      diagnostics: [],
      lastRun: null,
      errorReason: reason,
    };
  }

  if (st.isDirectory()) {
    return resolveWorkspace(entry, absolutePath, opts);
  }

  if (!st.isFile()) {
    return {
      entry,
      id,
      sourceKind: "file",
      absolutePath,
      status: "parse-error",
      title: basename(absolutePath),
      workflow: null,
      diagnostics: [
        {
          severity: "error",
          code: "NOT_A_FILE",
          message: "Registry source is neither a file nor a directory",
          source: entry.source,
        },
      ],
      lastRun: null,
      errorReason: "not a file",
    };
  }

  // Regular file — must be .md.
  if (!/\.md$/i.test(absolutePath)) {
    return {
      entry,
      id,
      sourceKind: "file",
      absolutePath,
      status: "parse-error",
      title: basename(absolutePath),
      workflow: null,
      diagnostics: [
        {
          severity: "error",
          code: "NOT_A_MARKDOWN_FILE",
          message: `Only .md files are supported (got "${basename(absolutePath)}")`,
          source: entry.source,
        },
      ],
      lastRun: null,
      errorReason: "not a .md",
    };
  }

  return resolveMarkdownFile(entry, absolutePath);
}

export async function resolveEntries(
  entries: ReadonlyArray<RegistryEntry>,
  opts: ResolverOptions,
): Promise<ReadonlyArray<ResolvedEntry>> {
  return Promise.all(entries.map((e) => resolveEntry(e, opts)));
}

/**
 * Produces a synthetic diagnostic from a thrown error so the resolver's
 * return shape stays uniform.
 */
export function synthesizeParseDiagnostic(
  err: unknown,
  sourceFile: string,
): ValidationDiagnostic {
  return {
    severity: "error",
    code: "PARSE_FAILED",
    message: errorMessage(err),
    source: sourceFile,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : JSON.stringify(err);
}

function classifyStatError(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code: unknown }).code;
    if (code === "ENOENT") return "404";
  }
  return errorMessage(err);
}

async function resolveMarkdownFile(
  entry: RegistryEntry,
  absolutePath: string,
): Promise<ResolvedEntry> {
  const id = formatEntryId(entry);
  let workflow: WorkflowDefinition;
  try {
    workflow = await parseWorkflow(absolutePath);
  } catch (err) {
    return {
      entry,
      id,
      sourceKind: "file",
      absolutePath,
      status: "parse-error",
      title: basename(absolutePath),
      workflow: null,
      diagnostics: [synthesizeParseDiagnostic(err, absolutePath)],
      lastRun: null,
      errorReason: errorMessage(err),
    };
  }

  const diagnostics = validateWorkflow(workflow);
  const hasErrors = diagnostics.some((d) => d.severity === "error");
  return {
    entry,
    id,
    sourceKind: "file",
    absolutePath,
    status: hasErrors ? "parse-error" : "valid",
    title: workflow.name || basename(absolutePath),
    workflow,
    diagnostics,
    // File-kind entries have no dedicated run directory — see plan §11 Q4.
    lastRun: null,
    errorReason: hasErrors ? "validation errors" : null,
  };
}

async function resolveWorkspace(
  entry: RegistryEntry,
  workspacePath: string,
  opts: ResolverOptions,
): Promise<ResolvedEntry> {
  const id = formatEntryId(entry);
  const sourceKind: EntrySourceKind = "workspace";

  // Try to read the workspace's .markflow.json for an authoritative pointer.
  const configPath = join(workspacePath, ".markflow.json");
  let workflowFilePath: string | null = null;
  let configReadError: string | null = null;
  try {
    const raw = await readFile(configPath, "utf8");
    try {
      const parsed = JSON.parse(raw) as { workflowPath?: unknown };
      if (typeof parsed.workflowPath === "string") {
        workflowFilePath = resolvePath(workspacePath, parsed.workflowPath);
      }
    } catch (err) {
      configReadError = `.markflow.json is not valid JSON: ${errorMessage(err)}`;
    }
  } catch (err) {
    if (err && typeof err === "object" && "code" in err) {
      const code = (err as { code: unknown }).code;
      if (code !== "ENOENT") configReadError = errorMessage(err);
    }
  }

  // Fallback: first *.md file in the workspace dir.
  if (workflowFilePath === null && configReadError === null) {
    try {
      const dirents = await readdir(workspacePath);
      const md = dirents.find((f) => /\.md$/i.test(f));
      if (md) workflowFilePath = join(workspacePath, md);
    } catch (err) {
      configReadError = errorMessage(err);
    }
  }

  if (workflowFilePath === null) {
    return {
      entry,
      id,
      sourceKind,
      absolutePath: workspacePath,
      status: "parse-error",
      title: basename(workspacePath),
      workflow: null,
      diagnostics: [
        {
          severity: "error",
          code: "NO_WORKFLOW_IN_WORKSPACE",
          message:
            configReadError ??
            "Workspace has no .markflow.json and no *.md file",
          source: entry.source,
        },
      ],
      lastRun: null,
      errorReason: configReadError ?? "no workflow",
    };
  }

  // Parse the workflow.
  let workflow: WorkflowDefinition;
  try {
    workflow = await parseWorkflow(workflowFilePath);
  } catch (err) {
    return {
      entry,
      id,
      sourceKind,
      absolutePath: workspacePath,
      status: "parse-error",
      title: basename(workflowFilePath),
      workflow: null,
      diagnostics: [synthesizeParseDiagnostic(err, workflowFilePath)],
      lastRun: null,
      errorReason: errorMessage(err),
    };
  }

  const diagnostics = validateWorkflow(workflow);
  const hasErrors = diagnostics.some((d) => d.severity === "error");
  const lastRun =
    opts.readLastRun === false ? null : await readLastRun(workspacePath);

  return {
    entry,
    id,
    sourceKind,
    absolutePath: workspacePath,
    status: hasErrors ? "parse-error" : "valid",
    title: workflow.name || basename(workspacePath),
    workflow,
    diagnostics,
    lastRun,
    errorReason: hasErrors ? "validation errors" : null,
  };
}

async function readLastRun(workspaceDir: string): Promise<LastRunInfo | null> {
  try {
    const runs: RunInfo[] = await createRunManager(workspaceDir).listRuns();
    if (runs.length === 0) return null;
    let best: RunInfo = runs[0]!;
    for (const r of runs) {
      if (
        Date.parse(r.startedAt || "") >
        Date.parse(best.startedAt || "")
      ) {
        best = r;
      }
    }
    return {
      status: best.status,
      endedAt: best.completedAt ?? null,
    };
  } catch {
    return null;
  }
}
