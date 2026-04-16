// test/theme/theme.test.ts
import { describe, it, expect } from "vitest";
import { buildTheme } from "../../src/theme/theme.js";
import {
  COLOR_TABLE,
  MONOCHROME_COLOR_TABLE,
} from "../../src/theme/tokens.js";
import {
  UNICODE_GLYPHS,
  ASCII_GLYPHS,
  UNICODE_FRAME,
  ASCII_FRAME,
  glyphKeyForRole,
} from "../../src/theme/glyphs.js";

describe("buildTheme", () => {
  it("capabilities.color=false → uses MONOCHROME_COLOR_TABLE", () => {
    const theme = buildTheme({ color: false, unicode: true });
    expect(theme.colors).toBe(MONOCHROME_COLOR_TABLE);
  });

  it("capabilities.color=true → uses COLOR_TABLE", () => {
    const theme = buildTheme({ color: true, unicode: true });
    expect(theme.colors).toBe(COLOR_TABLE);
  });

  it("capabilities.unicode=false → uses ASCII_GLYPHS", () => {
    const theme = buildTheme({ color: true, unicode: false });
    expect(theme.glyphs).toBe(ASCII_GLYPHS);
  });

  it("capabilities.unicode=true → uses UNICODE_GLYPHS", () => {
    const theme = buildTheme({ color: true, unicode: true });
    expect(theme.glyphs).toBe(UNICODE_GLYPHS);
  });

  it("produces a frozen Theme value", () => {
    const theme = buildTheme({ color: true, unicode: true });
    expect(Object.isFrozen(theme)).toBe(true);
  });

  it("all 4 capability quadrants round-trip through the lookup tables", () => {
    // (color, unicode) → (expected colors, expected glyphs)
    const quadrants: Array<[boolean, boolean, unknown, unknown]> = [
      [true, true, COLOR_TABLE, UNICODE_GLYPHS],
      [true, false, COLOR_TABLE, ASCII_GLYPHS],
      [false, true, MONOCHROME_COLOR_TABLE, UNICODE_GLYPHS],
      [false, false, MONOCHROME_COLOR_TABLE, ASCII_GLYPHS],
    ];
    for (const [color, unicode, expectedColors, expectedGlyphs] of quadrants) {
      const theme = buildTheme({ color, unicode });
      expect(theme.colors).toBe(expectedColors);
      expect(theme.glyphs).toBe(expectedGlyphs);
      expect(theme.capabilities.color).toBe(color);
      expect(theme.capabilities.unicode).toBe(unicode);
    }
  });
});

describe("COLOR_TABLE spec compliance (features.md §5.10)", () => {
  it("pending is dim (no hue)", () => {
    expect(COLOR_TABLE.pending).toEqual({ dim: true });
  });

  it("running is blue", () => {
    expect(COLOR_TABLE.running.color).toBe("blue");
  });

  it("complete is green", () => {
    expect(COLOR_TABLE.complete.color).toBe("green");
  });

  it("failed is red", () => {
    expect(COLOR_TABLE.failed.color).toBe("red");
  });

  it("skipped is gray + dim", () => {
    expect(COLOR_TABLE.skipped).toEqual({ color: "gray", dim: true });
  });

  it("waiting is yellow", () => {
    expect(COLOR_TABLE.waiting.color).toBe("yellow");
  });

  it("retrying is yellow", () => {
    expect(COLOR_TABLE.retrying.color).toBe("yellow");
  });

  it("timeout is red", () => {
    expect(COLOR_TABLE.timeout.color).toBe("red");
  });

  it("batch is magenta", () => {
    expect(COLOR_TABLE.batch.color).toBe("magenta");
  });

  it("route is cyan + dim", () => {
    expect(COLOR_TABLE.route).toEqual({ color: "cyan", dim: true });
  });
});

describe("MONOCHROME_COLOR_TABLE", () => {
  it("every role maps to an empty ColorSpec (inherit)", () => {
    for (const role of Object.keys(MONOCHROME_COLOR_TABLE) as Array<
      keyof typeof MONOCHROME_COLOR_TABLE
    >) {
      expect(MONOCHROME_COLOR_TABLE[role]).toEqual({});
    }
  });
});

describe("UNICODE_GLYPHS spec compliance (features.md §5.10 + plan.md line 294)", () => {
  it("contains exactly the 10 glyphs ⊙ ▶ ✓ ✗ ○ ⏸ ↻ ⏱ ⟳ →", () => {
    const values = Object.values(UNICODE_GLYPHS).sort();
    expect(values).toEqual(
      ["⊙", "▶", "✓", "✗", "○", "⏸", "↻", "⏱", "⟳", "→"].sort(),
    );
  });

  it.each([
    ["pending", "⊙"],
    ["running", "▶"],
    ["ok", "✓"],
    ["fail", "✗"],
    ["skipped", "○"],
    ["waiting", "⏸"],
    ["retry", "↻"],
    ["timeout", "⏱"],
    ["batch", "⟳"],
    ["arrow", "→"],
  ])("UNICODE_GLYPHS.%s === %s", (key, glyph) => {
    expect(UNICODE_GLYPHS[key as keyof typeof UNICODE_GLYPHS]).toBe(glyph);
  });

  it("matches the inline snapshot for the full table", () => {
    expect(UNICODE_GLYPHS).toMatchInlineSnapshot(`
      {
        "arrow": "→",
        "batch": "⟳",
        "fail": "✗",
        "ok": "✓",
        "pending": "⊙",
        "retry": "↻",
        "running": "▶",
        "skipped": "○",
        "timeout": "⏱",
        "waiting": "⏸",
      }
    `);
  });
});

describe("ASCII_GLYPHS tier", () => {
  it.each([
    ["pending", "[pend]"],
    ["running", "[run]"],
    ["ok", "[ok]"],
    ["fail", "[fail]"],
    ["skipped", "[skip]"],
    ["waiting", "[wait]"],
    ["retry", "[retry]"],
    ["timeout", "[time]"],
    ["batch", "[batch]"],
    ["arrow", "->"],
  ])("ASCII_GLYPHS.%s === %s", (key, glyph) => {
    expect(ASCII_GLYPHS[key as keyof typeof ASCII_GLYPHS]).toBe(glyph);
  });

  it("matches the inline snapshot for the full table", () => {
    expect(ASCII_GLYPHS).toMatchInlineSnapshot(`
      {
        "arrow": "->",
        "batch": "[batch]",
        "fail": "[fail]",
        "ok": "[ok]",
        "pending": "[pend]",
        "retry": "[retry]",
        "running": "[run]",
        "skipped": "[skip]",
        "timeout": "[time]",
        "waiting": "[wait]",
      }
    `);
  });

  it("distinguishes pending from waiting (no duplicate [wait])", () => {
    expect(ASCII_GLYPHS.pending).not.toBe(ASCII_GLYPHS.waiting);
  });
});

describe("buildTheme — frame glyphs", () => {
  it("unicode capabilities yield the box-drawing FrameGlyphs (╔ ╗ ╚ ╝ ═ ║ ╠ ╣)", () => {
    const theme = buildTheme({ color: true, unicode: true });
    expect(theme.frame).toBe(UNICODE_FRAME);
    expect(theme.frame.tl).toBe("╔");
    expect(theme.frame.tr).toBe("╗");
    expect(theme.frame.bl).toBe("╚");
    expect(theme.frame.br).toBe("╝");
    expect(theme.frame.h).toBe("═");
    expect(theme.frame.v).toBe("║");
    expect(theme.frame.mid_l).toBe("╠");
    expect(theme.frame.mid_r).toBe("╣");
    expect(theme.frame.mid_h).toBe("═");
  });

  it("ASCII capabilities yield the ASCII FrameGlyphs (+ + + + - | + +)", () => {
    const theme = buildTheme({ color: true, unicode: false });
    expect(theme.frame).toBe(ASCII_FRAME);
    expect(theme.frame.tl).toBe("+");
    expect(theme.frame.tr).toBe("+");
    expect(theme.frame.bl).toBe("+");
    expect(theme.frame.br).toBe("+");
    expect(theme.frame.h).toBe("-");
    expect(theme.frame.v).toBe("|");
    expect(theme.frame.mid_l).toBe("+");
    expect(theme.frame.mid_r).toBe("+");
    expect(theme.frame.mid_h).toBe("-");
  });

  it("frame glyphs are identical references across calls with equal capabilities (memo-friendly)", () => {
    const a = buildTheme({ color: true, unicode: true });
    const b = buildTheme({ color: false, unicode: true });
    expect(a.frame).toBe(b.frame);

    const c = buildTheme({ color: true, unicode: false });
    const d = buildTheme({ color: false, unicode: false });
    expect(c.frame).toBe(d.frame);
  });
});

describe("glyphKeyForRole", () => {
  it.each([
    ["pending", "pending"],
    ["running", "running"],
    ["complete", "ok"],
    ["failed", "fail"],
    ["skipped", "skipped"],
    ["waiting", "waiting"],
    ["retrying", "retry"],
    ["timeout", "timeout"],
    ["batch", "batch"],
    ["route", "arrow"],
  ] as const)("maps StatusRole %s → GlyphKey %s", (role, expected) => {
    expect(glyphKeyForRole(role)).toBe(expected);
  });

  it("throws on chrome roles ('accent'/'dim'/'danger')", () => {
    expect(() => glyphKeyForRole("accent")).toThrow(/no glyph/);
    expect(() => glyphKeyForRole("dim")).toThrow(/no glyph/);
    expect(() => glyphKeyForRole("danger")).toThrow(/no glyph/);
  });
});
