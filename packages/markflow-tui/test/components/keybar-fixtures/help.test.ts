// test/components/keybar-fixtures/help.test.ts
import { describe, it, expect } from "vitest";
import { HELP_KEYBAR } from "../../../src/components/keybar-fixtures/help.js";

describe("HELP_KEYBAR fixture", () => {
  it("contains Up/Down, /, Esc in order", () => {
    const firstKeys = HELP_KEYBAR.map((b) => b.keys[0]);
    expect(firstKeys).toEqual(["Up", "/", "Esc"]);
  });

  it("labels match mockup §15 HELP row", () => {
    expect(HELP_KEYBAR[0]!.label).toBe("Navigate");
    expect(HELP_KEYBAR[1]!.label).toBe("Search");
    expect(HELP_KEYBAR[2]!.label).toBe("Close");
  });

  it("all rows hide labels on short/keys tiers", () => {
    for (const b of HELP_KEYBAR) {
      expect(b.hideLabelOn).toEqual(["short", "keys"]);
    }
  });
});
