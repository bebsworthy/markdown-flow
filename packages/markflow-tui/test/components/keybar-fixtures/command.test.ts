// test/components/keybar-fixtures/command.test.ts
import { describe, it, expect } from "vitest";
import { COMMAND_KEYBAR } from "../../../src/components/keybar-fixtures/command.js";

describe("COMMAND_KEYBAR fixture", () => {
  it("contains Enter, Up/Down, Tab, Esc in order", () => {
    const firstKeys = COMMAND_KEYBAR.map((b) => b.keys[0]);
    expect(firstKeys).toEqual(["Enter", "Up", "Tab", "Esc"]);
  });

  it("labels match mockup §15 COMMAND row", () => {
    expect(COMMAND_KEYBAR[0]!.label).toBe("Run");
    expect(COMMAND_KEYBAR[1]!.label).toBe("Select");
    expect(COMMAND_KEYBAR[2]!.label).toBe("Complete");
    expect(COMMAND_KEYBAR[3]!.label).toBe("Cancel");
  });

  it("Up/Down, Tab, Esc hide labels on short/keys tiers", () => {
    for (const b of COMMAND_KEYBAR.slice(1)) {
      expect(b.hideLabelOn).toEqual(["short", "keys"]);
    }
  });
});
