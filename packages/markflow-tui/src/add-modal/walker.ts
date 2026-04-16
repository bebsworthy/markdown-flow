// src/add-modal/walker.ts
//
// Filesystem walker for the add modal's fuzzy-find tab (P4-T3).
//
// Authoritative references:
//   - docs/tui/plans/P4-T3.md §5.3.
//   - docs/tui/features.md §3.1 (Adding from inside the TUI).
//
// This module imports `node:fs/promises` and `node:path`; it is NOT pure
// and is explicitly NOT listed in test/state/purity.test.ts::files[].

import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type {
  Candidate,
  TruncatedSentinel,
  WalkerOptions,
} from "./types.js";

const DEFAULT_MAX = 500;
const DEFAULT_SKIP = [".git", "node_modules", ".markflow-tui"] as const;

/**
 * BFS walk starting at `root`. Yields `Candidate` for:
 *   - any *.md file (extension case-insensitive)
 *   - any directory that contains a `.markflow.json` (treated as a
 *     workspace; not descended into).
 *
 * Rules:
 *   - Skips directories whose basename starts with "." OR matches
 *     `opts.skipDirs` (default: `.git`, `node_modules`, `.markflow-tui`).
 *   - When `maxCandidates` is reached, a final `TruncatedSentinel` is
 *     yielded and iteration stops.
 *   - Fs errors (EACCES, ENOENT on a subdir, etc.) skip the offending dir
 *     silently; the walk continues with the remaining queue.
 *   - Honors `opts.signal`: after every yield, checks `signal.aborted` and
 *     returns cleanly.
 *
 * Deterministic ordering: siblings sorted case-folded ASC; BFS level-by-
 * level. Tests rely on this contract.
 */
export async function* walkCandidates(
  root: string,
  opts: WalkerOptions = {},
): AsyncGenerator<Candidate | TruncatedSentinel, void, void> {
  const cap = opts.maxCandidates ?? DEFAULT_MAX;
  const maxDepth = opts.maxDepth ?? Number.POSITIVE_INFINITY;
  const skipSet = new Set(opts.skipDirs ?? DEFAULT_SKIP);
  const signal = opts.signal;

  let yielded = 0;
  let scanned = 0;

  const queue: Array<{ dir: string; depth: number }> = [
    { dir: root, depth: 0 },
  ];

  while (queue.length > 0) {
    if (signal?.aborted) return;
    const item = queue.shift()!;
    const { dir, depth } = item;
    if (depth > maxDepth) continue;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    scanned += entries.length;

    entries.sort((a, b) => {
      const an = a.name.toLowerCase();
      const bn = b.name.toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    });

    // Detect whether this directory is itself a workspace.
    const hasConfig = entries.some(
      (e) => e.isFile() && e.name === ".markflow.json",
    );

    if (hasConfig && depth > 0) {
      // Don't classify the walk root as a "workspace" candidate — rare in
      // practice, and selecting a workspace via the fuzzy tab would be a
      // no-op from inside that workspace. Workspaces at depth ≥ 1 are fine.
      const rel = relative(root, dir);
      yield {
        kind: "workspace",
        absolutePath: dir,
        displayPath: rel.length > 0 ? rel : ".",
        depth,
      };
      yielded += 1;
      if (yielded >= cap) {
        yield { kind: "truncated", scannedCount: scanned };
        return;
      }
      if (signal?.aborted) return;
      continue; // do not descend into workspace
    }

    // Two passes: md files first (in sorted order), then queue directories
    // to descend.
    for (const entry of entries) {
      if (signal?.aborted) return;
      const full = join(dir, entry.name);
      if (entry.isFile()) {
        if (/\.md$/i.test(entry.name)) {
          const rel = relative(root, full);
          const display =
            rel.length > 0 && !rel.startsWith("..") ? rel : full;
          yield {
            kind: "file",
            absolutePath: full,
            displayPath: display.split(sep).join("/"),
            depth: depth + 1,
          };
          yielded += 1;
          if (yielded >= cap) {
            yield { kind: "truncated", scannedCount: scanned };
            return;
          }
        }
      } else if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        if (skipSet.has(entry.name)) continue;
        queue.push({ dir: full, depth: depth + 1 });
      }
    }
  }
}
