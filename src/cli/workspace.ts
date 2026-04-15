import { readFile, writeFile, stat, mkdir } from "node:fs/promises";
import { text } from "node:stream/consumers";
import { resolve, relative, basename, join } from "node:path";
import type { InputDeclaration } from "../core/types.js";

// ---- .markflow.json --------------------------------------------------------

export type WorkflowOrigin =
  | { type: "url"; url: string; fetchedAt: string }
  | { type: "stdin"; receivedAt: string };

export interface MarkflowJson {
  workflow: string; // path relative to workspace dir
  origin?: WorkflowOrigin;
}

export async function readMarkflowJson(
  workspaceDir: string,
): Promise<MarkflowJson | null> {
  try {
    const raw = await readFile(join(workspaceDir, ".markflow.json"), "utf-8");
    return JSON.parse(raw) as MarkflowJson;
  } catch {
    return null;
  }
}

export async function writeMarkflowJson(
  workspaceDir: string,
  relativeWorkflow: string,
  origin?: WorkflowOrigin,
): Promise<void> {
  const data: MarkflowJson = { workflow: relativeWorkflow };
  if (origin) data.origin = origin;
  await writeFile(
    join(workspaceDir, ".markflow.json"),
    JSON.stringify(data, null, 2) + "\n",
    "utf-8",
  );
}

// ---- Remote / stdin materialization ----------------------------------------

export function isRemoteTarget(target: string): boolean {
  return /^https?:\/\//i.test(target) || target === "-" || target === "@stdin";
}

export interface MaterializedTarget {
  workflowPath: string; // absolute path to the persisted local .md
  workspaceDir: string; // absolute path to the workspace that now contains it
  origin: WorkflowOrigin;
}

/**
 * If `target` is an http(s) URL or `-` (stdin), fetch/read the workflow,
 * persist it into a workspace directory, and return the local path.
 *
 * For URLs the workspace defaults to `./<basename-stem>`; for stdin
 * `--workspace` is required.
 *
 * `.markflow.json` is written (with `origin` recorded) so subsequent
 * `markflow run <workspace>` invocations reuse the frozen copy.
 *
 * Returns `null` if the target is a local file/directory.
 */
export async function materializeRemoteTarget(
  target: string,
  workspaceFlag: string | undefined,
): Promise<MaterializedTarget | null> {
  if (!isRemoteTarget(target)) return null;

  let content: string;
  let origin: WorkflowOrigin;
  let defaultStem: string;

  if (target === "-" || target === "@stdin") {
    if (!workspaceFlag) {
      throw new Error(
        "Reading workflow from stdin requires --workspace <dir>.",
      );
    }
    content = await text(process.stdin);
    origin = { type: "stdin", receivedAt: new Date().toISOString() };
    defaultStem = "flow";
  } else {
    const url = target;
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      throw new Error(
        `Failed to fetch workflow from ${url}: ${(err as Error).message}`,
      );
    }
    if (!res.ok) {
      throw new Error(
        `Failed to fetch workflow from ${url}: HTTP ${res.status} ${res.statusText}`,
      );
    }
    const ct = res.headers.get("content-type") ?? "";
    if (ct && !/text\/(markdown|plain|x-markdown)|application\/(octet-stream|markdown)/i.test(ct)) {
      process.stderr.write(
        `Warning: unexpected Content-Type "${ct}" for ${url}\n`,
      );
    }
    content = await res.text();
    origin = { type: "url", url, fetchedAt: new Date().toISOString() };
    let urlBase: string;
    try {
      urlBase = basename(new URL(url).pathname, ".md");
    } catch {
      urlBase = "";
    }
    defaultStem = urlBase && urlBase !== "/" ? urlBase : "flow";
  }

  const workspaceDir = resolve(workspaceFlag ?? `./${defaultStem}`);
  await mkdir(workspaceDir, { recursive: true });
  const workflowPath = join(workspaceDir, "flow.md");
  await writeFile(workflowPath, content, "utf-8");
  await writeMarkflowJson(workspaceDir, "flow.md", origin);

  return { workflowPath, workspaceDir, origin };
}

/**
 * Re-fetch a workspace's URL origin and overwrite flow.md + fetchedAt.
 * Throws if the workspace has no URL origin recorded.
 */
export async function refreshWorkspaceOrigin(
  workspaceDir: string,
): Promise<Extract<WorkflowOrigin, { type: "url" }>> {
  const meta = await readMarkflowJson(workspaceDir);
  if (!meta?.origin || meta.origin.type !== "url") {
    throw new Error(
      `--refresh requires a workspace with a URL origin; ` +
        `"${workspaceDir}" has no recorded URL origin.`,
    );
  }
  const url = meta.origin.url;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(
      `Failed to refresh from ${url}: ${(err as Error).message}`,
    );
  }
  if (!res.ok) {
    throw new Error(
      `Failed to refresh from ${url}: HTTP ${res.status} ${res.statusText}`,
    );
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct && !/text\/(markdown|plain|x-markdown)|application\/(octet-stream|markdown)/i.test(ct)) {
    process.stderr.write(
      `Warning: unexpected Content-Type "${ct}" for ${url}\n`,
    );
  }
  const content = await res.text();
  const workflowRel = meta.workflow;
  await writeFile(join(workspaceDir, workflowRel), content, "utf-8");
  const newOrigin: WorkflowOrigin = {
    type: "url",
    url,
    fetchedAt: new Date().toISOString(),
  };
  await writeMarkflowJson(workspaceDir, workflowRel, newOrigin);
  return newOrigin;
}

export interface PreparedTarget {
  target: string; // local .md path (or the original, if not remote)
  workspace: string | undefined; // resolved workspace path if materialized
  materialized: boolean;
  origin?: WorkflowOrigin;
}

/**
 * Normalise a CLI target for downstream commands: if remote/stdin, materialize
 * it to disk and return the local path + workspace; otherwise pass through.
 */
export async function prepareTarget(
  target: string,
  workspaceFlag: string | undefined,
): Promise<PreparedTarget> {
  const materialized = await materializeRemoteTarget(target, workspaceFlag);
  if (!materialized) {
    return { target, workspace: workspaceFlag, materialized: false };
  }
  return {
    target: materialized.workflowPath,
    workspace: materialized.workspaceDir,
    materialized: true,
    origin: materialized.origin,
  };
}

// ---- Target resolution -----------------------------------------------------

export interface ResolvedTarget {
  workflowPath: string; // absolute path to workflow .md
  workspaceDir: string; // absolute path to workspace folder
  workspaceExists: boolean;
}

/**
 * Resolve a CLI target (either a workflow .md path or a workspace directory)
 * into absolute workflow + workspace paths.
 *
 * Rules:
 *   - Existing directory  → workspace mode; reads .markflow.json for workflow
 *   - *.md path           → workflow mode; workspace = --workspace or ./<stem>
 *   - Anything else       → error
 */
export async function resolveTarget(
  target: string,
  workspaceFlag?: string,
): Promise<ResolvedTarget> {
  const absTarget = resolve(target);

  // Check if it's an existing directory
  let targetStat: Awaited<ReturnType<typeof stat>> | null = null;
  try {
    targetStat = await stat(absTarget);
  } catch {
    /* doesn't exist */
  }

  if (targetStat?.isDirectory()) {
    const wsData = await readMarkflowJson(absTarget);
    if (!wsData) {
      throw new Error(
        `"${target}" is not a markflow workspace — no .markflow.json found.\n` +
          `Run: markflow init <workflow.md> --workspace ${target}`,
      );
    }
    const workflowPath = resolve(absTarget, wsData.workflow);
    return { workflowPath, workspaceDir: absTarget, workspaceExists: true };
  }

  if (!absTarget.endsWith(".md")) {
    throw new Error(
      `"${target}" is neither a .md workflow file nor an existing workspace directory`,
    );
  }

  // Target is a workflow file — derive workspace
  const stem = basename(absTarget, ".md");
  const workspaceDir = resolve(workspaceFlag ?? `./${stem}`);

  let workspaceExists = false;
  try {
    const wsStat = await stat(workspaceDir);
    workspaceExists = wsStat.isDirectory();
  } catch {
    /* doesn't exist */
  }

  return { workflowPath: absTarget, workspaceDir, workspaceExists };
}

// ---- .env generation -------------------------------------------------------

/**
 * Generate .env content for a new workspace.
 * - Inputs with a provided value → active (KEY=value)
 * - Inputs with a default         → commented with default (# KEY=default)
 * - All other inputs              → empty placeholder (# KEY=)
 */
export function generateEnvContent(
  workflowName: string,
  inputs: InputDeclaration[],
  provided: Record<string, string>,
): string {
  const lines: string[] = [
    `# Generated by markflow init — ${workflowName}`,
    `# Uncomment and fill in required values.`,
    ``,
  ];

  for (const inp of inputs) {
    if (inp.name in provided) {
      lines.push(`${inp.name}=${provided[inp.name]}`);
    } else if (inp.default !== undefined) {
      lines.push(`# ${inp.name}=${inp.default}`);
    } else {
      lines.push(`# ${inp.name}=`);
    }
  }

  return lines.join("\n") + "\n";
}

// ---- .env update (additive) ------------------------------------------------

const KEY_RE = /^([A-Z_][A-Z0-9_]*)=(.*)$/;
const COMMENTED_KEY_RE = /^#\s*([A-Z_][A-Z0-9_]*)=(.*)$/;

/**
 * Update existing .env content.
 *
 * Rules (additive by default):
 *   - Lines for keys in `provided`  → made active with new value
 *   - Inputs in `inputs` not in file → appended as commented placeholders
 *   - Unknown keys not in `inputs`  → preserved unless `remove` is true
 *   - `remove: true`                → drops lines for keys absent from `inputs`
 */
export function updateEnvContent(
  existing: string,
  inputs: InputDeclaration[],
  provided: Record<string, string>,
  remove: boolean,
): string {
  const workflowKeys = new Set(inputs.map((i) => i.name));
  const defaultMap = new Map(
    inputs.filter((i) => i.default !== undefined).map((i) => [i.name, i.default!]),
  );

  const fileKeys = new Set<string>();
  const existingLines = existing.split("\n");

  const updatedLines: string[] = [];
  for (const line of existingLines) {
    const activeMatch = KEY_RE.exec(line);
    const commentedMatch = !activeMatch ? COMMENTED_KEY_RE.exec(line) : null;
    const key = activeMatch?.[1] ?? commentedMatch?.[1];

    if (!key) {
      updatedLines.push(line);
      continue;
    }

    fileKeys.add(key);

    // Drop if --remove and not in this workflow's inputs
    if (remove && !workflowKeys.has(key)) continue;

    // Apply provided value
    if (key in provided) {
      updatedLines.push(`${key}=${provided[key]}`);
      continue;
    }

    updatedLines.push(line);
  }

  // Append inputs not already in the file
  const newInputs = inputs.filter((i) => !fileKeys.has(i.name));
  if (newInputs.length > 0) {
    updatedLines.push("");
    for (const inp of newInputs) {
      if (inp.name in provided) {
        updatedLines.push(`${inp.name}=${provided[inp.name]}`);
      } else if (defaultMap.has(inp.name)) {
        updatedLines.push(`# ${inp.name}=${defaultMap.get(inp.name)}`);
      } else {
        updatedLines.push(`# ${inp.name}=`);
      }
    }
  }

  return updatedLines.join("\n");
}

// ---- Input parsing from --input flags --------------------------------------

export function parseInputFlags(flags: string[] | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of flags ?? []) {
    const eq = entry.indexOf("=");
    if (eq === -1) throw new Error(`Invalid --input value "${entry}": expected KEY=VALUE`);
    result[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return result;
}

// ---- Relative path helper --------------------------------------------------

/** Relative path from workspaceDir to workflowPath, normalised with forward slashes. */
export function workflowRelativePath(
  workspaceDir: string,
  workflowPath: string,
): string {
  return relative(workspaceDir, workflowPath).replace(/\\/g, "/");
}
