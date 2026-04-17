// test/palette/commands.test.ts
import { describe, it, expect } from "vitest";
import {
  COMMAND_BY_NAME,
  COMMANDS,
} from "../../src/palette/commands.js";
import type { CommandId } from "../../src/palette/types.js";

describe("command catalogue", () => {
  const expected: readonly CommandId[] = [
    "run",
    "resume",
    "rerun",
    "cancel",
    "approve",
    "pending",
    "goto",
    "theme",
    "quit",
  ];

  it("contains exactly the nine plan.md ids, each once", () => {
    const ids = COMMANDS.map((c) => c.id).sort();
    expect(ids).toEqual([...expected].sort());
    const unique = new Set(ids);
    expect(unique.size).toBe(COMMANDS.length);
  });

  it("COMMAND_BY_NAME lookup is consistent with COMMANDS", () => {
    for (const c of COMMANDS) {
      expect(COMMAND_BY_NAME.get(c.name)).toBe(c);
    }
    expect(COMMAND_BY_NAME.size).toBe(COMMANDS.length);
  });

  it("argRequired flags match §2.2 table", () => {
    const argRequiredIds: readonly CommandId[] = ["run", "rerun", "goto"];
    for (const c of COMMANDS) {
      const want = argRequiredIds.includes(c.id);
      expect(c.argRequired).toBe(want);
    }
  });
});
