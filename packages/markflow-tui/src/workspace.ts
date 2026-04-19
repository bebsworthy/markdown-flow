// src/workspace.ts
//
// Workspace resolution for running workflows. A workflow needs a writable
// workspace directory to store run artifacts (events.jsonl, step output).
//
// Two shapes:
//   - "workspace" entries already ARE a workspace — absolutePath is the root,
//     runsDir = join(absolutePath, "runs").
//   - "file" entries are bare .md files. The TUI creates a workspace under
//     <baseDir>/.markflow-tui/workspaces/<slug>/ (P4-T3 §6.3). The .md file
//     stays in place; only run artifacts live in the workspace.
//
// The baseDir is the directory that holds .markflow-tui.json — typically the
// CWD where the TUI was launched.

import { access, mkdir } from "node:fs/promises";
import { basename, join, resolve as resolvePath } from "node:path";
import type { EntrySourceKind } from "./browser/types.js";

export const WORKSPACES_SUBDIR = ".markflow-tui/workspaces";

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Slug-safe stem derived from an absolute file path. Strips `.md`, then
 * replaces everything outside `[A-Za-z0-9_.-]+` with `-`.
 */
export function fileSlug(absolutePath: string): string {
  const stem = basename(absolutePath, ".md");
  const safe = stem.replace(/[^A-Za-z0-9_.-]+/g, "-");
  return safe.length > 0 ? safe : "workflow";
}

/**
 * Return the deterministic workspace dir for a file slug:
 * `<baseDir>/.markflow-tui/workspaces/<slug>`. The same file always
 * maps to the same workspace so multiple runs accumulate under one
 * `runs/` directory.
 */
export function pickFileWorkspaceDir(
  baseDir: string,
  slug: string,
): string {
  return join(resolvePath(baseDir, WORKSPACES_SUBDIR), slug);
}

export interface WorkspaceInfo {
  readonly workspaceDir: string;
  readonly runsDir: string;
}

/**
 * Resolve the workspace and runsDir for a given entry. For workspace entries,
 * the absolutePath IS the workspace. For file entries, a workspace is
 * created/reused under .markflow-tui/workspaces/.
 *
 * Creates the workspace and runs directories on disk if they don't exist.
 */
export async function resolveEntryWorkspace(args: {
  readonly sourceKind: EntrySourceKind;
  readonly absolutePath: string;
  readonly baseDir: string;
}): Promise<WorkspaceInfo> {
  if (args.sourceKind === "workspace") {
    const runsDir = join(args.absolutePath, "runs");
    await mkdir(runsDir, { recursive: true });
    return { workspaceDir: args.absolutePath, runsDir };
  }

  const slug = fileSlug(args.absolutePath);
  const workspaceDir = pickFileWorkspaceDir(args.baseDir, slug);
  const runsDir = join(workspaceDir, "runs");
  await mkdir(runsDir, { recursive: true });
  return { workspaceDir, runsDir };
}
