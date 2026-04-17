// test/components/viewing-pane-tabs-layout.test.ts
//
// Unit tests for the viewing-pane tab-row layout helper (P8-T1 §4.1).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  composeViewingTabRow,
  formatViewingTabLabel,
  pickViewingTabTier,
  VIEWING_TAB_KEYS,
  VIEWING_TAB_MEDIUM_MIN,
  VIEWING_TAB_WIDE_MIN,
  type ViewingTabKey,
} from "../../src/components/viewing-pane-tabs-layout.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("pickViewingTabTier", () => {
  it(`width >= ${VIEWING_TAB_WIDE_MIN} → "wide"`, () => {
    expect(pickViewingTabTier(120)).toBe("wide");
    expect(pickViewingTabTier(200)).toBe("wide");
  });

  it(`${VIEWING_TAB_MEDIUM_MIN} <= width < ${VIEWING_TAB_WIDE_MIN} → "medium"`, () => {
    expect(pickViewingTabTier(90)).toBe("medium");
    expect(pickViewingTabTier(70)).toBe("medium");
    expect(pickViewingTabTier(119)).toBe("medium");
  });

  it(`width < ${VIEWING_TAB_MEDIUM_MIN} → "narrow"`, () => {
    expect(pickViewingTabTier(69)).toBe("narrow");
    expect(pickViewingTabTier(40)).toBe("narrow");
    expect(pickViewingTabTier(0)).toBe("narrow");
  });
});

describe("formatViewingTabLabel", () => {
  it("wide tier returns the full word", () => {
    expect(formatViewingTabLabel("graph", "wide")).toBe("Graph");
    expect(formatViewingTabLabel("detail", "wide")).toBe("Detail");
    expect(formatViewingTabLabel("log", "wide")).toBe("Log");
    expect(formatViewingTabLabel("events", "wide")).toBe("Events");
  });

  it("medium tier returns letter-bracketed form", () => {
    expect(formatViewingTabLabel("graph", "medium")).toBe("[G]raph");
    expect(formatViewingTabLabel("detail", "medium")).toBe("[D]etail");
    expect(formatViewingTabLabel("log", "medium")).toBe("[L]og");
    expect(formatViewingTabLabel("events", "medium")).toBe("[E]vents");
  });

  it("narrow tier returns single uppercase letter", () => {
    expect(formatViewingTabLabel("graph", "narrow")).toBe("G");
    expect(formatViewingTabLabel("detail", "narrow")).toBe("D");
    expect(formatViewingTabLabel("log", "narrow")).toBe("L");
    expect(formatViewingTabLabel("events", "narrow")).toBe("E");
  });
});

describe("composeViewingTabRow", () => {
  it("returns four tokens in the fixed key order", () => {
    const row = composeViewingTabRow("graph", 140);
    expect(row.tokens).toHaveLength(4);
    expect(row.tokens.map((t) => t.active)).toEqual([true, false, false, false]);
    const keys: ReadonlyArray<ViewingTabKey> = VIEWING_TAB_KEYS;
    expect(keys).toEqual(["graph", "detail", "log", "events"]);
  });

  it("medium tier: active token is 3rd for focus='log' with letter-bracket text", () => {
    const row = composeViewingTabRow("log", 90);
    expect(row.tier).toBe("medium");
    expect(row.tokens[0]!.text).toBe("[G]raph");
    expect(row.tokens[1]!.text).toBe("[D]etail");
    expect(row.tokens[2]!.text).toBe("[L]og");
    expect(row.tokens[3]!.text).toBe("[E]vents");
    expect(row.tokens[2]!.active).toBe(true);
  });

  it("wide tier: suffix is preserved verbatim", () => {
    const row = composeViewingTabRow(
      "graph",
      140,
      "abcd12 · deploy · build · seq=142",
    );
    expect(row.tier).toBe("wide");
    expect(row.suffix).toBe("abcd12 · deploy · build · seq=142");
  });

  it("medium tier: suffix is preserved verbatim", () => {
    const row = composeViewingTabRow("graph", 90, "abcd12 · deploy");
    expect(row.tier).toBe("medium");
    expect(row.suffix).toBe("abcd12 · deploy");
  });

  it("narrow tier: drops the suffix to null", () => {
    const row = composeViewingTabRow("graph", 60, "abcd12 · deploy");
    expect(row.tier).toBe("narrow");
    expect(row.suffix).toBeNull();
  });

  it("narrow tier: tokens are bare letters", () => {
    const row = composeViewingTabRow("detail", 50);
    expect(row.tokens.map((t) => t.text)).toEqual(["G", "D", "L", "E"]);
    expect(row.tokens.map((t) => t.active)).toEqual([false, true, false, false]);
  });

  it("missing suffix stays null at every tier", () => {
    expect(composeViewingTabRow("graph", 140).suffix).toBeNull();
    expect(composeViewingTabRow("graph", 90).suffix).toBeNull();
    expect(composeViewingTabRow("graph", 40).suffix).toBeNull();
  });

  it("empty suffix string is treated as null", () => {
    expect(composeViewingTabRow("graph", 140, "").suffix).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Import-boundary check (criterion 16)
// ---------------------------------------------------------------------------

describe("composeViewingTabRow import boundary", () => {
  const repoSrc = (rel: string): string =>
    resolve(__dirname, "..", "..", "src", rel);

  function readSrc(rel: string): string {
    return readFileSync(repoSrc(rel), "utf8");
  }

  it("is imported by viewing-panes.tsx", () => {
    const src = readSrc("components/viewing-panes.tsx");
    expect(src).toMatch(/composeViewingTabRow/);
    expect(src).toMatch(/viewing-pane-tabs-layout/);
  });

  it("is NOT imported by app-shell.tsx or mode-tabs.tsx", () => {
    const appShell = readSrc("components/app-shell.tsx");
    const modeTabs = readSrc("components/mode-tabs.tsx");
    expect(appShell).not.toMatch(/composeViewingTabRow/);
    expect(appShell).not.toMatch(/viewing-pane-tabs-layout/);
    expect(modeTabs).not.toMatch(/composeViewingTabRow/);
    expect(modeTabs).not.toMatch(/viewing-pane-tabs-layout/);
  });
});
