// test/browser/list-layout.test.ts
//
// Pure layout tests for the workflow browser list pane.

import { describe, it, expect } from "vitest";
import {
  composeListRows,
  computeCursorGlyph,
  formatListFooter,
  formatListTitle,
  pickBadgeColumnWidth,
  truncateSource,
} from "../../src/browser/list-layout.js";
import type { ResolvedEntry } from "../../src/browser/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResolved(overrides: Partial<ResolvedEntry> = {}): ResolvedEntry {
  return {
    entry: { source: "./x.md", addedAt: "2026-01-01T00:00:00Z" },
    id: "./x.md",
    sourceKind: "file",
    absolutePath: "/abs/x.md",
    status: "valid",
    title: "X",
    workflow: null,
    diagnostics: [],
    lastRun: null,
    errorReason: null,
    rawContent: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// pickBadgeColumnWidth
// ---------------------------------------------------------------------------

describe("pickBadgeColumnWidth", () => {
  it("file-only entries → at least 12 (min)", () => {
    const entries = [makeResolved({ sourceKind: "file" })];
    const w = pickBadgeColumnWidth(entries);
    expect(w).toBeGreaterThanOrEqual(12);
  });

  it("mix with workspace → 12 (longest badge '[workspace]' + 1 = 12)", () => {
    const entries = [
      makeResolved({ sourceKind: "file" }),
      makeResolved({ sourceKind: "workspace" }),
    ];
    expect(pickBadgeColumnWidth(entries)).toBe(12);
  });

  it("clamps to min 12, max 18", () => {
    expect(pickBadgeColumnWidth([])).toBeGreaterThanOrEqual(12);
    expect(pickBadgeColumnWidth([makeResolved()])).toBeLessThanOrEqual(18);
  });
});

// ---------------------------------------------------------------------------
// truncateSource
// ---------------------------------------------------------------------------

describe("truncateSource", () => {
  it("short string passes through unchanged", () => {
    expect(truncateSource("deploy.md", 40)).toBe("deploy.md");
  });

  it("long string middle-ellipsis preserves prefix and basename", () => {
    const result = truncateSource(
      "./very/long/path/to/some/flow/deploy.md",
      24,
    );
    expect(result.length).toBeLessThanOrEqual(24);
    expect(result).toContain("…");
    expect(result.endsWith("deploy.md")).toBe(true);
  });

  it("boundary: exactly maxWidth → unchanged", () => {
    const src = "abcdefghij";
    expect(truncateSource(src, 10)).toBe(src);
  });
});

// ---------------------------------------------------------------------------
// composeListRows — widths
// ---------------------------------------------------------------------------

describe("composeListRows — widths", () => {
  const entries: ResolvedEntry[] = [
    makeResolved({
      entry: { source: "./a.md", addedAt: "2026-01-01T00:00:00Z" },
      id: "./a.md",
    }),
    makeResolved({
      entry: { source: "./b.md", addedAt: "2026-01-02T00:00:00Z" },
      id: "./b.md",
      sourceKind: "workspace",
    }),
  ];

  it("at width=40 fits rows with flag column truncated to budget", () => {
    const rows = composeListRows(entries, -1, 40);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      // 2 (cursor) + source + badge + flag should be <= 40 (approx)
      const totalLen = r.cursorGlyph.length + r.sourceText.length + r.badgeText.length + r.flagText.length;
      expect(totalLen).toBeLessThanOrEqual(40);
    }
  });

  it("at width=60 fits source (short) + badge + flag", () => {
    const rows = composeListRows(entries, -1, 60);
    for (const r of rows) {
      expect(r.badgeText.length).toBeGreaterThanOrEqual(12);
    }
  });

  it("at width=80 each row is padded column-aligned", () => {
    const rows = composeListRows(entries, -1, 80);
    // All badgeText fields should have the same length (column alignment).
    const badgeWidths = rows.map((r) => r.badgeText.length);
    expect(new Set(badgeWidths).size).toBe(1);
  });

  it("at width=120 badge fully visible with padding", () => {
    const rows = composeListRows(entries, -1, 120);
    // Workspace badge should be visible in its row.
    const workspaceRow = rows.find((r) => r.badgeText.startsWith("[workspace]"));
    expect(workspaceRow).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// composeListRows — selection
// ---------------------------------------------------------------------------

describe("composeListRows — selection", () => {
  const entries: ResolvedEntry[] = [
    makeResolved({ id: "a" }),
    makeResolved({ id: "b" }),
    makeResolved({ id: "c" }),
  ];

  it("selectedIndex=0 places '▶ ' on first row, '  ' on rest", () => {
    const rows = composeListRows(entries, 0, 80);
    expect(rows[0]!.cursorGlyph).toBe("▶ ");
    expect(rows[1]!.cursorGlyph).toBe("  ");
    expect(rows[2]!.cursorGlyph).toBe("  ");
    expect(rows[0]!.isSelected).toBe(true);
    expect(rows[1]!.isSelected).toBe(false);
  });

  it("selectedIndex=-1 places '  ' on every row", () => {
    const rows = composeListRows(entries, -1, 80);
    for (const r of rows) {
      expect(r.cursorGlyph).toBe("  ");
      expect(r.isSelected).toBe(false);
    }
  });

  it("selectedIndex beyond length renders no cursor", () => {
    const rows = composeListRows(entries, 99, 80);
    for (const r of rows) {
      expect(r.cursorGlyph).toBe("  ");
      expect(r.isSelected).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// composeListRows — status tone
// ---------------------------------------------------------------------------

describe("composeListRows — status", () => {
  it("passes through status for caller-side color", () => {
    const entries: ResolvedEntry[] = [
      makeResolved({ status: "parse-error" }),
      makeResolved({ status: "valid" }),
    ];
    const rows = composeListRows(entries, -1, 80);
    expect(rows[0]!.status).toBe("parse-error");
    expect(rows[1]!.status).toBe("valid");
  });

  it("flagTone 'bad' for parse-error", () => {
    const entries = [makeResolved({ status: "parse-error" })];
    const rows = composeListRows(entries, -1, 80);
    expect(rows[0]!.flagTone).toBe("bad");
  });

  it("flagTone 'good' for valid+complete last run", () => {
    const now = Date.parse("2026-04-16T10:00:00Z");
    const endedAt = new Date(now - 60 * 1000).toISOString();
    const entries = [
      makeResolved({
        status: "valid",
        lastRun: { status: "complete", endedAt },
      }),
    ];
    const rows = composeListRows(entries, -1, 80);
    expect(rows[0]!.flagTone).toBe("good");
  });
});

// ---------------------------------------------------------------------------
// formatListFooter
// ---------------------------------------------------------------------------

describe("formatListFooter", () => {
  it("'5 entries · 1 error' when 1 parse-error", () => {
    const entries = [
      makeResolved({ status: "valid" }),
      makeResolved({ status: "valid" }),
      makeResolved({ status: "valid" }),
      makeResolved({ status: "valid" }),
      makeResolved({ status: "parse-error" }),
    ];
    expect(formatListFooter(entries)).toBe("5 entries · 1 error");
  });

  it("'5 entries' when none", () => {
    const entries: ResolvedEntry[] = Array.from({ length: 5 }, () =>
      makeResolved(),
    );
    expect(formatListFooter(entries)).toBe("5 entries");
  });

  it("'0 entries' for empty", () => {
    expect(formatListFooter([])).toBe("0 entries");
  });
});

// ---------------------------------------------------------------------------
// formatListTitle
// ---------------------------------------------------------------------------

describe("formatListTitle", () => {
  it("relative path → 'Workflows  (./.markflow-tui.json)'", () => {
    expect(
      formatListTitle("/home/alice/proj/.markflow-tui.json", "/home/alice/proj"),
    ).toBe("Workflows  (./.markflow-tui.json)");
  });

  it("absolute outside cwd → 'Workflows  (/abs/path.json)'", () => {
    expect(formatListTitle("/elsewhere/path.json", "/home/alice/proj")).toBe(
      "Workflows  (/elsewhere/path.json)",
    );
  });

  it("null path → 'Workflows  (session only)'", () => {
    expect(formatListTitle(null, "/home/alice/proj")).toBe(
      "Workflows  (session only)",
    );
  });
});

// ---------------------------------------------------------------------------
// computeCursorGlyph
// ---------------------------------------------------------------------------

describe("computeCursorGlyph", () => {
  it("returns '▶ ' when selected", () => {
    expect(computeCursorGlyph(3, 3)).toBe("▶ ");
  });
  it("returns '  ' when not selected", () => {
    expect(computeCursorGlyph(3, 4)).toBe("  ");
  });
});
