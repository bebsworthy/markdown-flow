// test/e2e/ansi.ts
//
// Pure helpers used by the Layer-3 node-pty harness:
//   - stripAnsi      — drop VT control sequences (Node 18.17+ built-in)
//   - canonicalize   — normalise whitespace + mask non-deterministic bits
//   - keys           — escape-sequence literals for `session.write(keys.ENTER)`
//
// See docs/tui/plans/P9-T1.md §2.1 and docs/tui/testing.md §2/§5.

import { stripVTControlCharacters } from "node:util";

/** Strip ANSI / VT control sequences from a string. */
export function stripAnsi(s: string): string {
  return stripVTControlCharacters(s);
}

const MASKS: ReadonlyArray<readonly [RegExp, string]> = [
  // Spinner glyphs — harness also pins MARKFLOW_TEST=1 but mask as belt+braces.
  [/[\u280B\u2819\u2839\u2838\u283C\u2834\u2826\u2827\u2807\u280F]/g, "*"],
  // Full ISO-8601 timestamps with offset/Z — before the date-only mask runs.
  [
    /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})\b/g,
    "<ts>",
  ],
  // UUIDs (8-4-4-4-12) first — before short-id mask clobbers fragments.
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, "<uuid>"],
  // Run ids — the engine emits 26-char ULID-style (nanoid base32). Mask any
  // 12-32 char [0-9a-z] token preceded by a likely label (`run`, `id`, `#`).
  [/\b(run|id|#)[: ]+[0-9a-z]{10,32}\b/gi, "$1 <runid>"],
  // 12:34:56 or 12:34:56.123 timestamps
  [/\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/g, "HH:MM:SS"],
  // ISO dates (YYYY-MM-DD) in case a detail header ever renders them
  [/\b\d{4}-\d{2}-\d{2}\b/g, "YYYY-MM-DD"],
  // compound durations: 1h2m, 3m45s, 1h, 90m, 2.5s — widen "single unit"
  // pattern to accept chains so elapsed columns normalise cleanly.
  [/\b\d+(?:\.\d+)?(?:ms|µs|us|s|m|h|d)(?:\d+(?:\.\d+)?(?:ms|s|m|h))*\b/g, "<dur>"],
  // ISO-8601 durations: PT1M30S etc
  [/\bPT(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?\b/g, "<dur>"],
  // absolute tmp paths (macOS /var/folders, linux /tmp)
  [/\/(?:private\/)?var\/folders\/[^\s)]+/g, "<tmp>"],
  [/\/tmp\/[A-Za-z0-9\-_.\/]+/g, "<tmp>"],
  // short hex ids
  [/\b[0-9a-f]{6,8}\b/g, "<id>"],
];

/**
 * Canonicalise captured screen text for assertion / snapshot comparison.
 * See docs/tui/plans/P9-T1.md §2.1.
 */
export function canonicalize(s: string): string {
  let out = stripAnsi(s).replace(/\r\n/g, "\n");
  for (const [re, rep] of MASKS) {
    out = out.replace(re, rep);
  }
  // Trim trailing whitespace per line (xterm cells pad to terminal width).
  out = out
    .split("\n")
    .map((line) => line.replace(/\s+$/u, ""))
    .join("\n");
  // Drop leading/trailing blank lines (they're a frame artefact).
  return out.replace(/^\n+|\n+$/g, "");
}

/** Control-char / escape-sequence literals for `session.write(...)`. */
export const keys = {
  ENTER: "\r",
  ESC: "\x1b",
  UP: "\x1b[A",
  DOWN: "\x1b[B",
  LEFT: "\x1b[D",
  RIGHT: "\x1b[C",
  TAB: "\t",
  BACKSPACE: "\x7f",
  CTRL_C: "\x03",
} as const;

export type Keys = typeof keys;
