// test/components/keybar-layout.test.ts
//
// Unit tests for the pure layout helpers in src/components/keybar-layout.ts.
// No Ink/React render surface exercised here; these tests run in a plain
// Node environment via Vitest.

import { describe, it, expect } from "vitest";
import {
  formatKeys,
  pickTier,
  filterBindings,
  sortByOrder,
  groupByCategory,
  renderableLabel,
  countCategories,
} from "../../src/components/keybar-layout.js";
import type { Binding, AppContext } from "../../src/components/types.js";

const noopCtx: AppContext = {
  mode: { kind: "browsing", pane: "workflows" },
  overlay: null,
  approvalsPending: false,
  isFollowing: false,
  isWrapped: false,
  toggleState: {},
};

function mkBinding(partial: Partial<Binding>): Binding {
  return {
    keys: ["x"],
    label: "X",
    when: () => true,
    action: () => {},
    ...partial,
  };
}

describe("formatKeys", () => {
  it.each<[ReadonlyArray<string>, string]>([
    [["r"], "r"],
    [["Ctrl", "r"], "Ctrl + <r>"],
    [["Up", "Down"], "\u2191\u2193"],
    [["Down", "Up"], "\u2191\u2193"],
    [["Left", "Right"], "\u2190\u2192"],
    [["Right", "Left"], "\u2190\u2192"],
    [["Left", "Down", "Up", "Right"], "\u2191\u2193\u2190\u2192"],
    [["Enter"], "\u23CE"],
    [["Esc"], "Esc"],
    [["Space"], "Space"],
    [["Tab"], "Tab"],
    [["?"], "?"],
    [["q"], "q"],
  ])("formatKeys(%j) === %s", (input, expected) => {
    expect(formatKeys(input)).toBe(expected);
  });

  it("passes unknown single tokens through literally", () => {
    expect(formatKeys(["F7"])).toBe("F7");
  });
});

describe("pickTier", () => {
  it.each<[number, number, "full" | "short" | "keys"]>([
    [120, 1, "full"],
    [100, 1, "full"],
    [100, 2, "full"],
    [99, 1, "short"],
    [60, 1, "short"],
    [60, 2, "short"],
    [59, 1, "keys"],
    [40, 3, "keys"],
    [20, 0, "keys"],
    // Category overflow forces full → short
    [120, 3, "short"],
    [99, 3, "short"],
    [40, 3, "keys"],
  ])("pickTier(width=%d, cats=%d) === %s", (w, c, expected) => {
    expect(pickTier(w, c)).toBe(expected);
  });
});

describe("filterBindings", () => {
  it("hides bindings whose when(ctx) returns false (rule 5)", () => {
    const bindings: Binding[] = [
      mkBinding({ keys: ["a"], label: "A", when: () => true }),
      mkBinding({ keys: ["b"], label: "B", when: () => false }),
      mkBinding({ keys: ["c"], label: "C", when: () => true }),
    ];
    const out = filterBindings(bindings, noopCtx);
    expect(out.map((b) => b.keys[0])).toEqual(["a", "c"]);
  });

  it("resolves toggleLabel from ctx.toggleState (rule 6)", () => {
    const b = mkBinding({
      keys: ["f"],
      label: "Follow",
      toggleLabel: (s) =>
        (s as { isFollowing?: boolean }).isFollowing ? "Unfollow" : "Follow",
    });
    const ctxFollowing: AppContext = { ...noopCtx, toggleState: { isFollowing: true } };
    const out = filterBindings([b], ctxFollowing);
    expect(out[0]!.label).toBe("Unfollow");
    const out2 = filterBindings([b], { ...noopCtx, toggleState: { isFollowing: false } });
    expect(out2[0]!.label).toBe("Follow");
  });

  it("leaves bindings without toggleLabel unchanged", () => {
    const b = mkBinding({ keys: ["x"], label: "eXplode" });
    const out = filterBindings([b], noopCtx);
    expect(out[0]!.label).toBe("eXplode");
  });
});

describe("sortByOrder", () => {
  it("places globals (?, q, Esc) last (rule 3)", () => {
    const bindings: Binding[] = [
      mkBinding({ keys: ["?"], label: "Help" }),
      mkBinding({ keys: ["a"], label: "A" }),
      mkBinding({ keys: ["q"], label: "Quit" }),
      mkBinding({ keys: ["b"], label: "B" }),
    ];
    const out = sortByOrder(bindings);
    expect(out.map((b) => b.keys[0])).toEqual(["a", "b", "?", "q"]);
  });

  it("places VIEW category between local verbs and globals", () => {
    const bindings: Binding[] = [
      mkBinding({ keys: ["?"], label: "Help" }),
      mkBinding({ keys: ["f"], label: "Follow", category: "VIEW" }),
      mkBinding({ keys: ["a"], label: "A" }),
    ];
    const out = sortByOrder(bindings);
    expect(out.map((b) => b.keys[0])).toEqual(["a", "f", "?"]);
  });

  it("is stable within a class", () => {
    const bindings: Binding[] = [
      mkBinding({ keys: ["a"], label: "A" }),
      mkBinding({ keys: ["b"], label: "B" }),
      mkBinding({ keys: ["c"], label: "C" }),
    ];
    const out = sortByOrder(bindings);
    expect(out.map((b) => b.keys[0])).toEqual(["a", "b", "c"]);
  });
});

describe("groupByCategory", () => {
  it("returns one [null, [...]] entry when no bindings have category", () => {
    const bindings: Binding[] = [
      mkBinding({ keys: ["a"], label: "A" }),
      mkBinding({ keys: ["b"], label: "B" }),
    ];
    const out = groupByCategory(bindings);
    expect(out.length).toBe(1);
    expect(out[0]![0]).toBeNull();
    expect(out[0]![1].length).toBe(2);
  });

  it("produces at-most-two category groups for a typical RUN-mode fixture", () => {
    const bindings: Binding[] = [
      mkBinding({ keys: ["a"], label: "Approve", category: "RUN" }),
      mkBinding({ keys: ["R"], label: "Re-run", category: "RUN" }),
      mkBinding({ keys: ["f"], label: "Follow", category: "VIEW" }),
    ];
    const out = groupByCategory(bindings);
    expect(out.length).toBe(2);
    expect(out[0]![0]).toBe("RUN");
    expect(out[1]![0]).toBe("VIEW");
  });

  it("preserves order within each group", () => {
    const bindings: Binding[] = [
      mkBinding({ keys: ["a"], label: "A", category: "RUN" }),
      mkBinding({ keys: ["b"], label: "B", category: "RUN" }),
      mkBinding({ keys: ["c"], label: "C", category: "RUN" }),
    ];
    const out = groupByCategory(bindings);
    expect(out[0]![1].map((b) => b.keys[0])).toEqual(["a", "b", "c"]);
  });
});

describe("renderableLabel", () => {
  it("full tier: returns 'KEYS LABEL'", () => {
    const b = mkBinding({ keys: ["r"], label: "Run" });
    expect(renderableLabel(b, "full")).toBe("r Run");
  });

  it("short tier with shortLabel: returns 'KEYS SHORT'", () => {
    const b = mkBinding({ keys: ["r"], label: "Run", shortLabel: "Rn" });
    expect(renderableLabel(b, "short")).toBe("r Rn");
  });

  it("short tier without shortLabel: returns 'KEYS'", () => {
    const b = mkBinding({ keys: ["r"], label: "Run" });
    expect(renderableLabel(b, "short")).toBe("r");
  });

  it("keys tier: returns 'KEYS'", () => {
    const b = mkBinding({ keys: ["r"], label: "Run", shortLabel: "Rn" });
    expect(renderableLabel(b, "keys")).toBe("r");
  });
});

describe("countCategories", () => {
  it("counts distinct non-null categories", () => {
    const bindings: Binding[] = [
      mkBinding({ keys: ["a"], label: "A", category: "RUN" }),
      mkBinding({ keys: ["b"], label: "B", category: "VIEW" }),
      mkBinding({ keys: ["c"], label: "C" }),
      mkBinding({ keys: ["d"], label: "D", category: "RUN" }),
    ];
    expect(countCategories(bindings)).toBe(2);
  });

  it("returns 0 when no categories are set", () => {
    const bindings: Binding[] = [mkBinding({}), mkBinding({ keys: ["y"] })];
    expect(countCategories(bindings)).toBe(0);
  });
});
