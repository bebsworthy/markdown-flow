// test/state/purity.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// NOTE: this TEST file is allowed to touch node:fs because it's a *lint*.
// The SUT (src/state/*.ts, src/engine/*.ts) must not.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FORBIDDEN = [
  /\bfrom\s+["']ink["']/,
  /\bfrom\s+["']ink\//,
  /\bfrom\s+["']react["']/,
  /\bfrom\s+["']react\//,
  /\bfrom\s+["']fs["']/,
  /\bfrom\s+["']fs\//,
  /\bfrom\s+["']path["']/,
  /\bfrom\s+["']child_process["']/,
  /\bimport\(\s*["']ink["']/,
  /\bimport\(\s*["']react["']/,
];

const files = [
  "../../src/state/reducer.ts",
  "../../src/state/types.ts",
  // Engine adapter + reducer — same no-React rule, but node:path is allowed
  // for adapter.ts only. See NODE_PATH_ONLY below.
  "../../src/engine/types.ts",
  "../../src/engine/reducer.ts",
  "../../src/engine/adapter.ts",
  "../../src/engine/index.ts",
  // Theme pure surface (P3-T3). NOTE: context.tsx is NOT in this list —
  // it is the designated React-boundary file for the theme slice.
  "../../src/theme/tokens.ts",
  "../../src/theme/glyphs.ts",
  "../../src/theme/capabilities.ts",
  "../../src/theme/theme.ts",
  "../../src/theme/index.ts",
];

/**
 * Files that are allowed to touch `node:path` (deterministic, side-effect-
 * free). Every other `node:*` import is still forbidden for these modules.
 */
const NODE_PATH_ONLY: ReadonlySet<string> = new Set([
  "../../src/engine/adapter.ts",
]);

const NODE_ANY = /\bfrom\s+["']node:([a-zA-Z_/-]+)["']/g;

describe("pure-module purity", () => {
  for (const rel of files) {
    it(`${rel} has no forbidden imports`, () => {
      const source = readFileSync(resolve(__dirname, rel), "utf8");
      for (const re of FORBIDDEN) {
        expect(source).not.toMatch(re);
      }
      // Scan every `node:*` import: only `node:path` is allowed, and only
      // in files listed in NODE_PATH_ONLY.
      const matches = [...source.matchAll(NODE_ANY)];
      for (const m of matches) {
        const spec = m[1];
        const allowed = NODE_PATH_ONLY.has(rel) && spec === "path";
        expect(
          allowed,
          `${rel} imports node:${spec} which is not in the allowlist`,
        ).toBe(true);
      }
    });
  }

  it("reducer module loads in a Node-only context", async () => {
    const mod = await import("../../src/state/reducer.js");
    expect(typeof mod.reducer).toBe("function");
    expect(mod.initialAppState).toBeDefined();
  });

  it("engine adapter loads without Ink/React", async () => {
    const mod = await import("../../src/engine/adapter.js");
    expect(typeof mod.createEngineAdapter).toBe("function");
  });

  it("engine reducer loads without Ink/React", async () => {
    const mod = await import("../../src/engine/reducer.js");
    expect(typeof mod.engineReducer).toBe("function");
    expect(typeof mod.toEngineAction).toBe("function");
    expect(mod.initialEngineState).toBeDefined();
  });

  it("theme tokens module loads without Ink/React", async () => {
    const mod = await import("../../src/theme/tokens.js");
    expect(mod.COLOR_TABLE).toBeDefined();
    expect(mod.MONOCHROME_COLOR_TABLE).toBeDefined();
  });

  it("theme glyphs module loads without Ink/React", async () => {
    const mod = await import("../../src/theme/glyphs.js");
    expect(mod.UNICODE_GLYPHS).toBeDefined();
    expect(mod.ASCII_GLYPHS).toBeDefined();
    expect(typeof mod.glyphKeyForRole).toBe("function");
  });

  it("theme capabilities module loads without Ink/React", async () => {
    const mod = await import("../../src/theme/capabilities.js");
    expect(typeof mod.detectCapabilities).toBe("function");
  });

  it("theme buildTheme loads without Ink/React", async () => {
    const mod = await import("../../src/theme/theme.js");
    expect(typeof mod.buildTheme).toBe("function");
  });
});
