// src/add-modal/url-ingest.ts
//
// URL-based workflow ingestion for the add modal (P4-T3).
//
// Authoritative references:
//   - docs/tui/plans/P4-T3.md §5.5 + §6.
//   - docs/tui/features.md §3.1 (URL paste).
//
// Uses global `fetch`, `node:fs/promises`, and `node:path`. NOT pure; NOT
// listed in test/state/purity.test.ts::files[].
//
// Disk layout mirrors the engine's `materializeRemoteTarget` exactly, so
// that a future task can swap this implementation for a direct engine
// export with zero on-disk churn.

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve as resolvePath } from "node:path";
import type { UrlIngestResult } from "./types.js";

const WORKSPACES_SUBDIR = ".markflow-tui/workspaces";

interface MarkflowJsonShape {
  readonly workflow: string;
  readonly origin?: {
    readonly type: "url";
    readonly url: string;
    readonly fetchedAt: string;
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

/**
 * Slug-safe stem derived from a URL's last path component. Strips `.md`
 * (if any), then replaces everything outside `[A-Za-z0-9_.-]+` with `-`.
 * Falls back to `"flow"` on parse failure or empty stem.
 */
export function urlSlug(url: string): string {
  try {
    const u = new URL(url);
    const stem = basename(u.pathname, ".md");
    const safe = stem.replace(/[^A-Za-z0-9_.-]+/g, "-");
    return safe.length > 0 ? safe : "flow";
  } catch {
    return "flow";
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pick a workspace dir under `<baseDir>/.markflow-tui/workspaces/<slug>`,
 * resolving slug collisions by appending `-2`, `-3`, … until an unused
 * slot is found — UNLESS the existing `.markflow.json` already records the
 * same URL, in which case we reuse the existing dir (idempotent re-fetch).
 */
async function pickWorkspaceDir(
  baseDir: string,
  slug: string,
  url: string,
): Promise<string> {
  const root = resolvePath(baseDir, WORKSPACES_SUBDIR);
  const candidate = join(root, slug);
  if (!(await exists(candidate))) return candidate;

  // Directory exists — check if the .markflow.json points at our URL.
  try {
    const raw = await readFile(join(candidate, ".markflow.json"), "utf8");
    const parsed = JSON.parse(raw) as MarkflowJsonShape;
    if (parsed?.origin?.type === "url" && parsed.origin.url === url) {
      return candidate; // same URL → overwrite (idempotent).
    }
  } catch {
    // missing / malformed config → treat as collision
  }

  for (let i = 2; i < 100; i++) {
    const alt = join(root, `${slug}-${i}`);
    if (!(await exists(alt))) return alt;
    try {
      const raw = await readFile(join(alt, ".markflow.json"), "utf8");
      const parsed = JSON.parse(raw) as MarkflowJsonShape;
      if (parsed?.origin?.type === "url" && parsed.origin.url === url) {
        return alt;
      }
    } catch {
      // continue
    }
  }
  return join(root, `${slug}-${Date.now()}`);
}

/**
 * Fetch a workflow from `url` and persist it as a workspace. Returns an
 * ingest result. NEVER throws — all errors become `{ok: false, reason}`.
 *
 * On success writes:
 *   `<workspaceDir>/flow.md`          (UTF-8 body from fetch)
 *   `<workspaceDir>/.markflow.json`   (engine-compatible shape)
 */
export async function ingestUrl(
  url: string,
  baseDir: string,
): Promise<UrlIngestResult> {
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, reason: "expected http:// or https://" };
  }

  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    return { ok: false, reason: `network error: ${errorMessage(err)}` };
  }

  if (!res.ok) {
    return {
      ok: false,
      reason: `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`,
    };
  }

  let body: string;
  try {
    body = await res.text();
  } catch (err) {
    return { ok: false, reason: `failed to read body: ${errorMessage(err)}` };
  }

  const slug = urlSlug(url);
  const workspaceDir = await pickWorkspaceDir(baseDir, slug, url);
  const workflowPath = join(workspaceDir, "flow.md");

  try {
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(workflowPath, body, "utf8");
    const config: MarkflowJsonShape = {
      workflow: "flow.md",
      origin: {
        type: "url",
        url,
        fetchedAt: new Date().toISOString(),
      },
    };
    await writeFile(
      join(workspaceDir, ".markflow.json"),
      JSON.stringify(config, null, 2) + "\n",
      "utf8",
    );
  } catch (err) {
    return { ok: false, reason: `failed to write workspace: ${errorMessage(err)}` };
  }

  return { ok: true, workspaceDir, workflowPath };
}
