// src/theme/index.ts
//
// Pure barrel. Intentionally does NOT re-export from ./context.tsx —
// importers that only need the tables and detection logic must not pull
// in React. React consumers import from ./context directly.

export type { Capabilities, DetectOptions } from "./capabilities.js";
export { detectCapabilities } from "./capabilities.js";

export type {
  ColorRole,
  StatusRole,
  ChromeRole,
  ColorSpec,
  ColorTable,
} from "./tokens.js";
export { COLOR_TABLE, MONOCHROME_COLOR_TABLE } from "./tokens.js";

export type { GlyphKey, GlyphTable } from "./glyphs.js";
export {
  UNICODE_GLYPHS,
  ASCII_GLYPHS,
  glyphKeyForRole,
} from "./glyphs.js";

export type { Theme } from "./theme.js";
export { buildTheme } from "./theme.js";
