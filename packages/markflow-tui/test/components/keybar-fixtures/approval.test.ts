// test/components/keybar-fixtures/approval.test.ts
//
// Data-only assertions for the APPROVAL keybar fixture (P7-T1).

import { describe, it, expect } from "vitest";
import { APPROVAL_KEYBAR } from "../../../src/components/keybar-fixtures/approval.js";

describe("APPROVAL_KEYBAR fixture", () => {
  it("contains Enter Decide, s Suspend-for-later (shortLabel Suspend), Esc Cancel, ? Help", () => {
    const keysInOrder = APPROVAL_KEYBAR.map((b) => b.keys[0]);
    expect(keysInOrder).toEqual(["Enter", "s", "Esc", "?"]);
    expect(APPROVAL_KEYBAR[0]!.label).toBe("Decide");
    expect(APPROVAL_KEYBAR[1]!.label).toBe("Suspend-for-later");
    expect(APPROVAL_KEYBAR[1]!.shortLabel).toBe("Suspend");
    expect(APPROVAL_KEYBAR[2]!.label).toBe("Cancel");
    expect(APPROVAL_KEYBAR[3]!.label).toBe("Help");
  });

  it("hides `? Help` on the keys tier", () => {
    const help = APPROVAL_KEYBAR.find((b) => b.keys[0] === "?");
    expect(help?.hideOnTier).toEqual(["keys"]);
  });

  it("does NOT include an `e Edit inputs` binding", () => {
    const hasEditInputs = APPROVAL_KEYBAR.some((b) => b.keys[0] === "e");
    expect(hasEditInputs).toBe(false);
  });
});
