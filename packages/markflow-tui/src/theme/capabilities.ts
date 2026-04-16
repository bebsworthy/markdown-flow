// src/theme/capabilities.ts

/** Runtime capability hints. Kept minimal and immutable. */
export interface Capabilities {
  /** Whether colored output is supported / desired. */
  readonly color: boolean;
  /** Whether unicode glyphs are supported / desired. */
  readonly unicode: boolean;
}

export interface DetectOptions {
  /**
   * Whether stdout is a TTY. Callers pass `process.stdout.isTTY`.
   * Defaults to `false` when omitted — the conservative choice for CI,
   * piped output, and non-TTY harnesses.
   */
  readonly stdoutIsTTY?: boolean;
}

/**
 * Capability detection precedence (highest to lowest):
 *   1. `MARKFLOW_ASCII=1`            → unicode = false
 *   2. `NO_COLOR` (any non-empty)    → color   = false (https://no-color.org)
 *   3. `TERM=dumb`                   → color   = false
 *   4. Locale heuristic              → unicode = /UTF-?8/i.test(LC_ALL || LC_CTYPE || LANG)
 *                                              && stdoutIsTTY
 *   5. Default                       → color = stdoutIsTTY, unicode = false (conservative)
 *
 * All inputs are read from the `env` argument — never from `process.env`
 * directly — so tests can construct synthetic environments.
 */
export function detectCapabilities(
  env: NodeJS.ProcessEnv,
  opts: DetectOptions = {},
): Capabilities {
  const stdoutIsTTY = opts.stdoutIsTTY ?? false;

  // 1. Hard override for ASCII forcing.
  const forceAscii = env.MARKFLOW_ASCII === "1";

  // 2. NO_COLOR — presence of the var (any non-empty string) disables
  //    color. The spec explicitly says empty string is treated as "not
  //    set" (https://no-color.org/).
  const noColor =
    typeof env.NO_COLOR === "string" && env.NO_COLOR.length > 0;

  // 3. TERM=dumb — ancient-but-live signal for "no ANSI".
  const dumbTerm = env.TERM === "dumb";

  // 4. Locale heuristic. Pick the first non-empty of LC_ALL > LC_CTYPE >
  //    LANG (POSIX precedence). UTF-8 match is case-insensitive and
  //    tolerant of "UTF-8", "UTF8", "utf-8", and "utf8".
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
  const utf8Locale = /UTF-?8/i.test(locale);

  const color = !(noColor || dumbTerm) && stdoutIsTTY;
  const unicode = !forceAscii && utf8Locale && stdoutIsTTY;

  return Object.freeze({ color, unicode });
}
