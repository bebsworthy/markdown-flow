// src/log/ansi.ts
//
// Bespoke ANSI parser for the log panel (P6-T3). Recognises a meaningful
// subset of SGR (CSI m) color / bold / dim / italic / underline attributes
// and strips every other CSI / OSC / C1 / ESC-only escape sequence.
//
// PURITY NOTE: no `ink` / `react` / `node:*` imports. Pure string in, pure
// structured output.

import type { AnsiColor, LogLineSegment } from "./types.js";

// ---------------------------------------------------------------------------
// ANSI regex
// ---------------------------------------------------------------------------

/**
 * Matches every ANSI escape we care about:
 *   \x1b\[…(letter)   CSI
 *   \x1b\].*?(\x07|\x1b\\)  OSC
 *   \x1b[A-Za-z@-_]    ESC-only
 */
export const ANSI_PATTERN: RegExp =
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\].*?(?:\x07|\x1b\\)|\x1b[@-Z\\-_a-z]/g;

/** Strip every ANSI / OSC / ESC sequence, returning plain text. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

// ---------------------------------------------------------------------------
// SGR state
// ---------------------------------------------------------------------------

export interface SgrState {
  readonly color?: AnsiColor;
  readonly bgColor?: AnsiColor;
  readonly bold?: true;
  readonly dim?: true;
  readonly italic?: true;
  readonly underline?: true;
}

const FG_NAMES: Readonly<Record<number, AnsiColor>> = {
  30: "black", 31: "red", 32: "green", 33: "yellow",
  34: "blue", 35: "magenta", 36: "cyan", 37: "white",
  90: "gray", 91: "brightRed", 92: "brightGreen", 93: "brightYellow",
  94: "brightBlue", 95: "brightMagenta", 96: "brightCyan", 97: "brightWhite",
};

const BG_NAMES: Readonly<Record<number, AnsiColor>> = {
  40: "black", 41: "red", 42: "green", 43: "yellow",
  44: "blue", 45: "magenta", 46: "cyan", 47: "white",
  100: "gray", 101: "brightRed", 102: "brightGreen", 103: "brightYellow",
  104: "brightBlue", 105: "brightMagenta", 106: "brightCyan", 107: "brightWhite",
};

/**
 * Apply one parsed SGR parameter list (e.g. `[1, 31]`) to an SgrState,
 * returning the new state. Unknown codes are dropped without changing state.
 * Walks the list left-to-right so extended sequences (38;5;N / 38;2;r;g;b)
 * are consumed correctly.
 */
function applySgrCodes(state: SgrState, codes: number[]): SgrState {
  let s: SgrState = state;
  let i = 0;
  while (i < codes.length) {
    const c = codes[i]!;
    if (c === 0) {
      s = {};
    } else if (c === 1) {
      s = { ...s, bold: true };
    } else if (c === 2) {
      s = { ...s, dim: true };
    } else if (c === 3) {
      s = { ...s, italic: true };
    } else if (c === 4) {
      s = { ...s, underline: true };
    } else if (c === 22) {
      const { bold: _b, dim: _d, ...rest } = s;
      s = rest;
    } else if (c === 23) {
      const { italic: _i, ...rest } = s;
      s = rest;
    } else if (c === 24) {
      const { underline: _u, ...rest } = s;
      s = rest;
    } else if (c === 39) {
      const { color: _c, ...rest } = s;
      s = rest;
    } else if (c === 49) {
      const { bgColor: _bg, ...rest } = s;
      s = rest;
    } else if (c === 38 || c === 48) {
      const mode = codes[i + 1];
      if (mode === 5 && typeof codes[i + 2] === "number") {
        const color: AnsiColor = { kind: "256", index: codes[i + 2]! };
        s = c === 38 ? { ...s, color } : { ...s, bgColor: color };
        i += 3;
        continue;
      }
      if (
        mode === 2 &&
        typeof codes[i + 2] === "number" &&
        typeof codes[i + 3] === "number" &&
        typeof codes[i + 4] === "number"
      ) {
        const color: AnsiColor = {
          kind: "rgb",
          r: codes[i + 2]!,
          g: codes[i + 3]!,
          b: codes[i + 4]!,
        };
        s = c === 38 ? { ...s, color } : { ...s, bgColor: color };
        i += 5;
        continue;
      }
      // Unknown extended — drop this token.
      i += 1;
      continue;
    } else if (FG_NAMES[c]) {
      s = { ...s, color: FG_NAMES[c]! };
    } else if (BG_NAMES[c]) {
      s = { ...s, bgColor: BG_NAMES[c]! };
    }
    // Unknown code → silent drop.
    i += 1;
  }
  return s;
}

function sgrToSegmentAttrs(s: SgrState): Omit<LogLineSegment, "text"> {
  const out: Omit<LogLineSegment, "text"> = {};
  if (s.color !== undefined) (out as { color?: AnsiColor }).color = s.color;
  if (s.bgColor !== undefined) (out as { bgColor?: AnsiColor }).bgColor = s.bgColor;
  if (s.bold) (out as { bold?: true }).bold = true;
  if (s.dim) (out as { dim?: true }).dim = true;
  if (s.italic) (out as { italic?: true }).italic = true;
  if (s.underline) (out as { underline?: true }).underline = true;
  return out;
}

// ---------------------------------------------------------------------------
// parseAnsi
// ---------------------------------------------------------------------------

/**
 * Parse `text` into ANSI-aware segments. Returns the trailing `final` SGR
 * state so chunked streams can carry SGR context across chunk boundaries.
 * Every non-SGR escape sequence (OSC / cursor movement / ESC-only) is
 * stripped entirely.
 */
export function parseAnsi(
  text: string,
  initial: SgrState = {},
): { readonly segments: readonly LogLineSegment[]; readonly final: SgrState } {
  const segments: LogLineSegment[] = [];
  let state: SgrState = initial;
  let buf = "";

  const flush = (): void => {
    if (buf.length === 0) return;
    segments.push({ text: buf, ...sgrToSegmentAttrs(state) });
    buf = "";
  };

  // Walk using a sticky regex so literal text is preserved between matches.
  const re = new RegExp(ANSI_PATTERN.source, "g");
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > lastIndex) {
      buf += text.slice(lastIndex, m.index);
    }
    const seq = m[0]!;
    if (seq.startsWith("\x1b[") && seq.endsWith("m")) {
      // SGR — flush current buffer with current attrs, then update state.
      flush();
      const inner = seq.slice(2, -1);
      const codes = inner === ""
        ? [0]
        : inner.split(";").map((p) => {
            const n = Number.parseInt(p, 10);
            return Number.isFinite(n) ? n : 0;
          });
      state = applySgrCodes(state, codes);
    }
    // Any other escape sequence (OSC, cursor-move CSI, ESC-only) is stripped.
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) {
    buf += text.slice(lastIndex);
  }
  flush();

  return { segments, final: state };
}
