// test/registry/helpers.test.ts
//
// Pure helper unit tests (P4-T1 §6.1). Zero I/O; exercises only the
// data transforms in src/registry/helpers.ts.

import { describe, it, expect } from "vitest";
import {
  validateEntry,
  parseRegistryJson,
  serializeRegistry,
  addEntry,
  removeEntry,
  isSameSource,
  sortByAddedAt,
} from "../../src/registry/helpers.js";
import type { RegistryEntry, RegistryState } from "../../src/registry/types.js";

const E = (source: string, addedAt: string): RegistryEntry => ({
  source,
  addedAt,
});

describe("validateEntry", () => {
  it("accepts { source: string, addedAt: ISO-string }", () => {
    expect(validateEntry(E("./a.md", "2026-04-15T10:22:00Z"))).toBe(true);
  });

  it("accepts entries with extra fields (forward-compat)", () => {
    expect(
      validateEntry({
        source: "./a.md",
        addedAt: "2026-04-15T10:22:00Z",
        extra: "ignored",
      }),
    ).toBe(true);
  });

  it("rejects null", () => {
    expect(validateEntry(null)).toBe(false);
  });

  it("rejects non-object values (42, 'foo', [])", () => {
    expect(validateEntry(42)).toBe(false);
    expect(validateEntry("foo")).toBe(false);
    expect(validateEntry([])).toBe(false);
  });

  it("rejects missing source", () => {
    expect(validateEntry({ addedAt: "2026-04-15T10:22:00Z" })).toBe(false);
  });

  it("rejects non-string source", () => {
    expect(validateEntry({ source: 42, addedAt: "2026-04-15T10:22:00Z" })).toBe(
      false,
    );
  });

  it("rejects missing addedAt", () => {
    expect(validateEntry({ source: "./a.md" })).toBe(false);
  });

  it("rejects non-string addedAt", () => {
    expect(validateEntry({ source: "./a.md", addedAt: 12345 })).toBe(false);
  });

  it("rejects addedAt that is not a parseable date", () => {
    expect(validateEntry({ source: "./a.md", addedAt: "not-a-date" })).toBe(
      false,
    );
  });
});

describe("parseRegistryJson", () => {
  it("returns empty state for '[]'", () => {
    expect(parseRegistryJson("[]")).toEqual({ entries: [] });
  });

  it("returns state with entries for a valid 2-entry file", () => {
    const raw = JSON.stringify([
      { source: "./a.md", addedAt: "2026-04-15T10:22:00Z" },
      { source: "./b.md", addedAt: "2026-04-15T11:00:00Z" },
    ]);
    const out = parseRegistryJson(raw);
    expect(out).not.toBeNull();
    expect(out!.entries.length).toBe(2);
    expect(out!.entries[0]!.source).toBe("./a.md");
    expect(out!.entries[1]!.source).toBe("./b.md");
  });

  it("returns null for syntactically invalid JSON", () => {
    expect(parseRegistryJson("{not json")).toBeNull();
  });

  it("returns null for top-level object (not array)", () => {
    expect(parseRegistryJson('{"a": 1}')).toBeNull();
  });

  it("returns null for top-level string (not array)", () => {
    expect(parseRegistryJson('"foo"')).toBeNull();
  });

  it("returns null for array containing a non-entry", () => {
    expect(parseRegistryJson("[42]")).toBeNull();
  });

  it("returns null for array with entry missing addedAt", () => {
    expect(parseRegistryJson('[{"source": "./a.md"}]')).toBeNull();
  });

  it("preserves entry order from the input array", () => {
    const raw = JSON.stringify([
      { source: "./z.md", addedAt: "2026-04-15T10:22:00Z" },
      { source: "./a.md", addedAt: "2026-04-15T11:00:00Z" },
      { source: "./m.md", addedAt: "2026-04-15T12:00:00Z" },
    ]);
    const out = parseRegistryJson(raw)!;
    expect(out.entries.map((e) => e.source)).toEqual([
      "./z.md",
      "./a.md",
      "./m.md",
    ]);
  });
});

describe("serializeRegistry", () => {
  it("produces 2-space indentation", () => {
    const s = serializeRegistry({
      entries: [E("./a.md", "2026-04-15T10:22:00Z")],
    });
    expect(s).toContain('  "source": "./a.md"');
  });

  it("ends with a single trailing newline", () => {
    const s = serializeRegistry({ entries: [] });
    expect(s.endsWith("\n")).toBe(true);
    expect(s.endsWith("\n\n")).toBe(false);
  });

  it("is parseable back via parseRegistryJson (round-trip)", () => {
    const state: RegistryState = {
      entries: [
        E("./a.md", "2026-04-15T10:22:00Z"),
        E("./b.md", "2026-04-15T11:00:00Z"),
      ],
    };
    const roundTrip = parseRegistryJson(serializeRegistry(state));
    expect(roundTrip).toEqual(state);
  });

  it("empty state serialises to '[]\\n' (with newline)", () => {
    expect(serializeRegistry({ entries: [] })).toBe("[]\n");
  });
});

describe("addEntry", () => {
  it("appends a new entry when source not present", () => {
    const state: RegistryState = {
      entries: [E("./a.md", "2026-04-15T10:22:00Z")],
    };
    const next = addEntry(state, E("./b.md", "2026-04-15T11:00:00Z"));
    expect(next.entries.map((e) => e.source)).toEqual(["./a.md", "./b.md"]);
  });

  it("replaces + moves-to-end when source matches (dedupe)", () => {
    const state: RegistryState = {
      entries: [
        E("./a.md", "2026-04-15T10:22:00Z"),
        E("./b.md", "2026-04-15T11:00:00Z"),
        E("./c.md", "2026-04-15T12:00:00Z"),
      ],
    };
    const next = addEntry(state, E("./a.md", "2026-04-16T09:00:00Z"));
    expect(next.entries.map((e) => e.source)).toEqual([
      "./b.md",
      "./c.md",
      "./a.md",
    ]);
    expect(next.entries[2]!.addedAt).toBe("2026-04-16T09:00:00Z");
  });

  it("does not mutate the input state", () => {
    const state: RegistryState = {
      entries: [E("./a.md", "2026-04-15T10:22:00Z")],
    };
    const before = JSON.parse(JSON.stringify(state));
    addEntry(state, E("./b.md", "2026-04-15T11:00:00Z"));
    expect(state).toEqual(before);
  });

  it("preserves order of other entries on replace", () => {
    const state: RegistryState = {
      entries: [
        E("./a.md", "2026-04-15T10:00:00Z"),
        E("./b.md", "2026-04-15T11:00:00Z"),
        E("./c.md", "2026-04-15T12:00:00Z"),
        E("./d.md", "2026-04-15T13:00:00Z"),
      ],
    };
    const next = addEntry(state, E("./b.md", "2026-04-16T00:00:00Z"));
    expect(next.entries.map((e) => e.source)).toEqual([
      "./a.md",
      "./c.md",
      "./d.md",
      "./b.md",
    ]);
  });
});

describe("removeEntry", () => {
  it("removes entries matching the predicate", () => {
    const state: RegistryState = {
      entries: [
        E("./a.md", "2026-04-15T10:00:00Z"),
        E("./b.md", "2026-04-15T11:00:00Z"),
      ],
    };
    const next = removeEntry(state, (e) => e.source === "./a.md");
    expect(next.entries.map((e) => e.source)).toEqual(["./b.md"]);
  });

  it("is a no-op when predicate matches nothing", () => {
    const state: RegistryState = {
      entries: [E("./a.md", "2026-04-15T10:00:00Z")],
    };
    const next = removeEntry(state, (e) => e.source === "./nope.md");
    expect(next.entries).toEqual(state.entries);
  });

  it("does not mutate the input state", () => {
    const state: RegistryState = {
      entries: [E("./a.md", "2026-04-15T10:00:00Z")],
    };
    const before = JSON.parse(JSON.stringify(state));
    removeEntry(state, () => true);
    expect(state).toEqual(before);
  });

  it("removes multiple entries when predicate matches many", () => {
    const state: RegistryState = {
      entries: [
        E("./a.md", "2026-04-15T10:00:00Z"),
        E("./b.md", "2026-04-15T11:00:00Z"),
        E("./c.md", "2026-04-15T12:00:00Z"),
      ],
    };
    const next = removeEntry(state, (e) => e.source.startsWith("./a") || e.source.startsWith("./c"));
    expect(next.entries.map((e) => e.source)).toEqual(["./b.md"]);
  });
});

describe("isSameSource", () => {
  it("returns true for byte-identical strings", () => {
    expect(isSameSource("./a.md", "./a.md")).toBe(true);
  });

  it("returns false for strings differing only by case", () => {
    expect(isSameSource("./A.md", "./a.md")).toBe(false);
  });

  it("returns false for strings differing only by trailing slash", () => {
    expect(isSameSource("./foo/", "./foo")).toBe(false);
  });

  it("returns false for './foo' vs 'foo'", () => {
    expect(isSameSource("./foo", "foo")).toBe(false);
  });
});

describe("sortByAddedAt", () => {
  it("sorts descending by addedAt", () => {
    const entries = [
      E("./a.md", "2026-04-15T10:00:00Z"),
      E("./b.md", "2026-04-15T12:00:00Z"),
      E("./c.md", "2026-04-15T11:00:00Z"),
    ];
    expect(sortByAddedAt(entries).map((e) => e.source)).toEqual([
      "./b.md",
      "./c.md",
      "./a.md",
    ]);
  });

  it("is stable for equal timestamps", () => {
    const entries = [
      E("./a.md", "2026-04-15T10:00:00Z"),
      E("./b.md", "2026-04-15T10:00:00Z"),
      E("./c.md", "2026-04-15T10:00:00Z"),
    ];
    expect(sortByAddedAt(entries).map((e) => e.source)).toEqual([
      "./a.md",
      "./b.md",
      "./c.md",
    ]);
  });

  it("returns a new array (no mutation)", () => {
    const entries = [
      E("./a.md", "2026-04-15T10:00:00Z"),
      E("./b.md", "2026-04-15T12:00:00Z"),
    ];
    const before = [...entries];
    sortByAddedAt(entries);
    expect(entries).toEqual(before);
  });
});
