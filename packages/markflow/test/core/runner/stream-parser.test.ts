// Protects against: incorrect routing due to malformed RESULT lines,
// silent data loss from GLOBAL/LOCAL parse failures, and edge cases
// in the streaming line buffer.

import { describe, it, expect } from "vitest";
import { createStreamParser } from "../../../src/core/runner/stream-parser.js";

describe("createStreamParser", () => {
  describe("LOCAL sentinel parsing", () => {
    // Protects against: LOCAL lines not being accumulated in the local context
    it("accumulates LOCAL lines into the local record", () => {
      const parser = createStreamParser();
      parser.feed('LOCAL: {"a": 1}\n');
      parser.feed('LOCAL: {"b": 2}\n');
      const result = parser.finish();
      expect(result.local).toEqual({ a: 1, b: 2 });
    });

    // Protects against: later LOCAL lines not overwriting earlier keys
    it("later LOCAL keys overwrite earlier ones (shallow merge)", () => {
      const parser = createStreamParser();
      parser.feed('LOCAL: {"key": "first"}\n');
      parser.feed('LOCAL: {"key": "second"}\n');
      const result = parser.finish();
      expect(result.local.key).toBe("second");
    });
  });

  describe("GLOBAL sentinel parsing", () => {
    // Protects against: GLOBAL lines not being accumulated in the global context
    it("accumulates GLOBAL lines into the global record", () => {
      const parser = createStreamParser();
      parser.feed('GLOBAL: {"region": "us"}\n');
      parser.feed('GLOBAL: {"tier": "pro"}\n');
      const result = parser.finish();
      expect(result.global).toEqual({ region: "us", tier: "pro" });
    });
  });

  describe("RESULT sentinel parsing", () => {
    // Protects against: RESULT not being parsed for edge and summary fields
    it("extracts edge and summary from RESULT line", () => {
      const parser = createStreamParser();
      parser.feed('RESULT: {"edge": "pass", "summary": "ok"}\n');
      const result = parser.finish();
      expect(result.result).toEqual({ edge: "pass", summary: "ok" });
    });

    // Protects against: non-string edge/summary types being passed through
    it("ignores non-string edge and summary values", () => {
      const parser = createStreamParser();
      parser.feed('RESULT: {"edge": 42, "summary": true}\n');
      const result = parser.finish();
      expect(result.result).toEqual({ edge: undefined, summary: undefined });
    });

    // Protects against: multiple RESULT lines silently overwriting each other
    it("records an error on multiple RESULT lines and keeps the first", () => {
      const parser = createStreamParser();
      parser.feed('RESULT: {"edge": "first"}\n');
      parser.feed('RESULT: {"edge": "second"}\n');
      const result = parser.finish();
      expect(result.result?.edge).toBe("first");
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.errors.some((e) => /Multiple RESULT/.test(e))).toBe(true);
    });

    // Protects against: RESULT containing local/global keys which should be separate
    it("records an error when RESULT contains local or global keys", () => {
      const parser = createStreamParser();
      parser.feed(
        'RESULT: {"edge": "pass", "local": {"x": 1}, "global": {"y": 2}}\n',
      );
      const result = parser.finish();
      expect(result.errors).toHaveLength(2);
      expect(result.errors.some((e) => /local/.test(e))).toBe(true);
      expect(result.errors.some((e) => /global/.test(e))).toBe(true);
    });

    // Protects against: RESULT with only edge (no summary) breaking
    it("handles RESULT with only edge field", () => {
      const parser = createStreamParser();
      parser.feed('RESULT: {"edge": "done"}\n');
      const result = parser.finish();
      expect(result.result).toEqual({ edge: "done", summary: undefined });
    });

    // Protects against: RESULT with empty object not setting edge/summary
    it("handles RESULT with empty object", () => {
      const parser = createStreamParser();
      parser.feed("RESULT: {}\n");
      const result = parser.finish();
      expect(result.result).toEqual({ edge: undefined, summary: undefined });
    });
  });

  describe("malformed input handling", () => {
    // Protects against: malformed JSON causing a crash instead of being silently skipped
    it("silently ignores malformed JSON on sentinel lines", () => {
      const parser = createStreamParser();
      parser.feed("RESULT: not-json\n");
      parser.feed('LOCAL: {"valid": true}\n');
      const result = parser.finish();
      expect(result.result).toBeUndefined();
      expect(result.local).toEqual({ valid: true });
      expect(result.errors).toEqual([]);
    });

    // Protects against: arrays being treated as valid sentinel payloads
    it("ignores array JSON payloads on sentinel lines", () => {
      const parser = createStreamParser();
      parser.feed("RESULT: [1, 2, 3]\n");
      const result = parser.finish();
      expect(result.result).toBeUndefined();
    });

    // Protects against: null JSON being treated as a valid object payload
    it("ignores null JSON payloads on sentinel lines", () => {
      const parser = createStreamParser();
      parser.feed("LOCAL: null\n");
      const result = parser.finish();
      expect(result.local).toEqual({});
    });

    // Protects against: primitive JSON values being treated as object payloads
    it("ignores string JSON payloads on sentinel lines", () => {
      const parser = createStreamParser();
      parser.feed('GLOBAL: "just a string"\n');
      const result = parser.finish();
      expect(result.global).toEqual({});
    });

    // Protects against: number JSON being treated as object payload
    it("ignores number JSON payloads on sentinel lines", () => {
      const parser = createStreamParser();
      parser.feed("LOCAL: 42\n");
      const result = parser.finish();
      expect(result.local).toEqual({});
    });
  });

  describe("line buffering", () => {
    // Protects against: chunked input losing data at chunk boundaries
    it("handles data split across multiple feed() calls", () => {
      const parser = createStreamParser();
      parser.feed('LOCAL: {"a"');
      parser.feed(': 1}\nLOCAL: {"b": 2}\n');
      const result = parser.finish();
      expect(result.local).toEqual({ a: 1, b: 2 });
    });

    // Protects against: last line without newline being dropped
    it("processes the final line on finish() even without trailing newline", () => {
      const parser = createStreamParser();
      parser.feed('RESULT: {"edge": "done"}');
      const result = parser.finish();
      expect(result.result?.edge).toBe("done");
    });

    // Protects against: non-sentinel lines interfering with sentinel parsing
    it("ignores non-sentinel lines (prose, logs, etc.)", () => {
      const parser = createStreamParser();
      parser.feed("Starting process...\n");
      parser.feed("Step 1 complete\n");
      parser.feed('RESULT: {"edge": "pass"}\n');
      parser.feed("Cleaning up...\n");
      const result = parser.finish();
      expect(result.result?.edge).toBe("pass");
      expect(result.local).toEqual({});
      expect(result.global).toEqual({});
    });

    // Protects against: Windows line endings breaking parsing
    it("handles Windows-style CRLF line endings", () => {
      const parser = createStreamParser();
      parser.feed('LOCAL: {"x": 1}\r\nRESULT: {"edge": "done"}\r\n');
      const result = parser.finish();
      expect(result.local).toEqual({ x: 1 });
      expect(result.result?.edge).toBe("done");
    });

    // Protects against: empty lines causing parse errors
    it("handles empty lines without errors", () => {
      const parser = createStreamParser();
      parser.feed('\n\nLOCAL: {"a": 1}\n\n');
      const result = parser.finish();
      expect(result.local).toEqual({ a: 1 });
      expect(result.errors).toEqual([]);
    });
  });

  describe("prototype pollution guard (via safeMerge)", () => {
    // Protects against: step output polluting Object.prototype through LOCAL/GLOBAL
    it("blocks __proto__ in LOCAL payloads", () => {
      const parser = createStreamParser();
      const payload = JSON.stringify({ __proto__: { isAdmin: true }, safe: 1 });
      parser.feed(`LOCAL: ${payload}\n`);
      const result = parser.finish();
      expect(result.local.safe).toBe(1);
      expect(({} as any).isAdmin).toBeUndefined();
    });

    it("blocks __proto__ in GLOBAL payloads", () => {
      const parser = createStreamParser();
      const payload = JSON.stringify({
        __proto__: { isAdmin: true },
        region: "us",
      });
      parser.feed(`GLOBAL: ${payload}\n`);
      const result = parser.finish();
      expect(result.global.region).toBe("us");
      expect(({} as any).isAdmin).toBeUndefined();
    });
  });
});
