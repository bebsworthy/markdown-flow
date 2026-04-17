// test/components/keybar-fixtures/resume.test.ts
//
// Data-only assertions for the RESUME keybar fixture (P7-T2).

import { describe, it, expect } from "vitest";
import { RESUME_KEYBAR } from "../../../src/components/keybar-fixtures/resume.js";

describe("RESUME_KEYBAR fixture", () => {
  it("has bindings in order Enter / Space / Tab / p / Esc / ?", () => {
    const keysInOrder = RESUME_KEYBAR.map((b) => b.keys[0]);
    expect(keysInOrder).toEqual(["Enter", "Space", "Tab", "p", "Esc", "?"]);
  });

  it("labels match mockups §15 RESUME row", () => {
    const byKey = new Map(RESUME_KEYBAR.map((b) => [b.keys[0], b]));
    expect(byKey.get("Enter")!.label).toBe("Resume");
    expect(byKey.get("Space")!.label).toBe("Toggle");
    expect(byKey.get("Tab")!.label).toBe("Next field");
    expect(byKey.get("p")!.label).toBe("Preview");
    expect(byKey.get("Esc")!.label).toBe("Cancel");
    expect(byKey.get("?")!.label).toBe("Help");
  });

  it("Tab has shortLabel 'Next'", () => {
    const tab = RESUME_KEYBAR.find((b) => b.keys[0] === "Tab");
    expect(tab?.shortLabel).toBe("Next");
  });

  it("hides `? Help` on the keys tier only", () => {
    const help = RESUME_KEYBAR.find((b) => b.keys[0] === "?");
    expect(help?.hideOnTier).toEqual(["keys"]);
  });

  it("every binding has a `when` predicate and an `action`", () => {
    for (const b of RESUME_KEYBAR) {
      expect(typeof b.when).toBe("function");
      expect(typeof b.action).toBe("function");
    }
  });

  it("Preview stays visible on all tiers (non-MVP stub per plan §7 D7)", () => {
    const preview = RESUME_KEYBAR.find((b) => b.keys[0] === "p");
    // Not declared hidden on any tier.
    expect(preview?.hideOnTier ?? []).toEqual([]);
  });
});
