// src/theme/theme.ts
import type { Capabilities } from "./capabilities.js";
import type { ColorTable } from "./tokens.js";
import type { GlyphTable } from "./glyphs.js";
import { COLOR_TABLE, MONOCHROME_COLOR_TABLE } from "./tokens.js";
import { UNICODE_GLYPHS, ASCII_GLYPHS } from "./glyphs.js";

export interface Theme {
  readonly colors: ColorTable;
  readonly glyphs: GlyphTable;
  readonly capabilities: Capabilities;
}

/**
 * Builds an immutable Theme for the given capabilities. Pure — calling
 * twice with equal caps returns structurally equal Themes (same table
 * references; no per-call allocation for the tables themselves).
 */
export function buildTheme(capabilities: Capabilities): Theme {
  return Object.freeze({
    colors: capabilities.color ? COLOR_TABLE : MONOCHROME_COLOR_TABLE,
    glyphs: capabilities.unicode ? UNICODE_GLYPHS : ASCII_GLYPHS,
    capabilities,
  });
}
