// test/state/purity.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// NOTE: this TEST file is allowed to touch node:fs because it's a *lint*.
// The SUT (src/state/reducer.ts, src/state/types.ts) must not.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FORBIDDEN = [
  /\bfrom\s+["']ink["']/,
  /\bfrom\s+["']ink\//,
  /\bfrom\s+["']react["']/,
  /\bfrom\s+["']react\//,
  /\bfrom\s+["']node:/,
  /\bfrom\s+["']fs["']/,
  /\bfrom\s+["']fs\//,
  /\bfrom\s+["']path["']/,
  /\bfrom\s+["']child_process["']/,
  /\bimport\(\s*["']ink["']/,
  /\bimport\(\s*["']react["']/,
];

const files = ["../../src/state/reducer.ts", "../../src/state/types.ts"];

describe("reducer / types purity", () => {
  for (const rel of files) {
    it(`${rel} has no forbidden imports`, () => {
      const source = readFileSync(resolve(__dirname, rel), "utf8");
      for (const re of FORBIDDEN) {
        expect(source).not.toMatch(re);
      }
    });
  }

  it("reducer module loads in a Node-only context", async () => {
    const mod = await import("../../src/state/reducer.js");
    expect(typeof mod.reducer).toBe("function");
    expect(mod.initialAppState).toBeDefined();
  });
});
