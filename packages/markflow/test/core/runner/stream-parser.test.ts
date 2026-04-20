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
    it("treats non-JSON RESULT text as shorthand (edge)", () => {
      const parser = createStreamParser();
      parser.feed("RESULT: not-json\n");
      parser.feed('LOCAL: {"valid": true}\n');
      const result = parser.finish();
      expect(result.result).toEqual({ edge: "not-json", summary: undefined });
      expect(result.local).toEqual({ valid: true });
      expect(result.errors).toEqual([]);
    });

    // RESULT shorthand: non-JSON text (including arrays) is parsed as edge label
    it("treats array-looking RESULT text as shorthand edge", () => {
      const parser = createStreamParser();
      parser.feed("RESULT: [1, 2, 3]\n");
      const result = parser.finish();
      expect(result.result).toEqual({ edge: "[1, 2, 3]", summary: undefined });
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

  describe("multiline JSON accumulation", () => {
    it("accumulates multiline GLOBAL JSON until braces balance", () => {
      const parser = createStreamParser();
      parser.feed('GLOBAL: {\n');
      parser.feed('  "count": 3,\n');
      parser.feed('  "status": "ok"\n');
      parser.feed("}\n");
      const result = parser.finish();
      expect(result.global).toEqual({ count: 3, status: "ok" });
    });

    it("handles bare GLOBAL: followed by JSON on next lines", () => {
      const parser = createStreamParser();
      parser.feed("GLOBAL:\n");
      parser.feed('{"regions": ["us", "eu"]}\n');
      const result = parser.finish();
      expect(result.global).toEqual({ regions: ["us", "eu"] });
    });

    it("handles jq-style pretty-printed multiline JSON", () => {
      const parser = createStreamParser();
      parser.feed("GLOBAL:\n");
      parser.feed("{\n");
      parser.feed('  "payload": {\n');
      parser.feed('    "items": [\n');
      parser.feed('      "alpha",\n');
      parser.feed('      "beta"\n');
      parser.feed("    ]\n");
      parser.feed("  },\n");
      parser.feed('  "count": 2\n');
      parser.feed("}\n");
      const result = parser.finish();
      expect(result.global).toEqual({
        payload: { items: ["alpha", "beta"] },
        count: 2,
      });
    });

    it("handles multiline LOCAL", () => {
      const parser = createStreamParser();
      parser.feed("LOCAL:\n");
      parser.feed('{"ts": 123, "region": "us-east"}\n');
      const result = parser.finish();
      expect(result.local).toEqual({ ts: 123, region: "us-east" });
    });

    it("handles multiline RESULT with JSON", () => {
      const parser = createStreamParser();
      parser.feed("RESULT:\n");
      parser.feed("{\n");
      parser.feed('  "edge": "pass",\n');
      parser.feed('  "summary": "all good"\n');
      parser.feed("}\n");
      const result = parser.finish();
      expect(result.result).toEqual({ edge: "pass", summary: "all good" });
    });

    it("handles braces inside JSON string values correctly", () => {
      const parser = createStreamParser();
      parser.feed('GLOBAL: {"msg": "use { and } carefully"}\n');
      const result = parser.finish();
      expect(result.global).toEqual({ msg: "use { and } carefully" });
    });

    it("handles multiline with braces inside string values", () => {
      const parser = createStreamParser();
      parser.feed("GLOBAL:\n");
      parser.feed("{\n");
      parser.feed('  "template": "Hello {name}",\n');
      parser.feed('  "count": 1\n');
      parser.feed("}\n");
      const result = parser.finish();
      expect(result.global).toEqual({ template: "Hello {name}", count: 1 });
    });

    it("errors on unterminated JSON block at EOF", () => {
      const parser = createStreamParser();
      parser.feed("GLOBAL: {\n");
      parser.feed('  "count": 3\n');
      const result = parser.finish();
      expect(result.global).toEqual({});
      expect(result.errors.some((e) => /Unterminated/.test(e))).toBe(true);
    });

    it("errors when a new sentinel interrupts accumulation", () => {
      const parser = createStreamParser();
      parser.feed("GLOBAL: {\n");
      parser.feed('  "count": 3\n');
      parser.feed('LOCAL: {"x": 1}\n');
      const result = parser.finish();
      expect(result.global).toEqual({});
      expect(result.local).toEqual({ x: 1 });
      expect(result.errors.some((e) => /Unterminated/.test(e))).toBe(true);
    });

    it("prose between sentinels does not interfere with multiline", () => {
      const parser = createStreamParser();
      parser.feed("Starting work...\n");
      parser.feed("GLOBAL:\n");
      parser.feed('{"a": 1}\n');
      parser.feed("Done.\n");
      parser.feed('RESULT: {"edge": "pass"}\n');
      const result = parser.finish();
      expect(result.global).toEqual({ a: 1 });
      expect(result.result?.edge).toBe("pass");
    });

    it("accumulates across chunked feed() calls", () => {
      const parser = createStreamParser();
      parser.feed("GLOBAL: {");
      parser.feed('"a": 1,\n"b"');
      parser.feed(": 2}\nRESULT: pass\n");
      const result = parser.finish();
      expect(result.global).toEqual({ a: 1, b: 2 });
      expect(result.result?.edge).toBe("pass");
    });
  });

  describe("RESULT shorthand", () => {
    it("parses bare edge", () => {
      const parser = createStreamParser();
      parser.feed("RESULT: pass\n");
      const result = parser.finish();
      expect(result.result).toEqual({ edge: "pass", summary: undefined });
    });

    it("parses edge | summary", () => {
      const parser = createStreamParser();
      parser.feed("RESULT: fail | region us-east unhealthy\n");
      const result = parser.finish();
      expect(result.result).toEqual({
        edge: "fail",
        summary: "region us-east unhealthy",
      });
    });

    it("trims whitespace around edge and summary", () => {
      const parser = createStreamParser();
      parser.feed("RESULT:   pass   |   done processing   \n");
      const result = parser.finish();
      expect(result.result).toEqual({ edge: "pass", summary: "done processing" });
    });

    it("still supports JSON RESULT for backward compat", () => {
      const parser = createStreamParser();
      parser.feed('RESULT: {"edge": "pass", "summary": "ok"}\n');
      const result = parser.finish();
      expect(result.result).toEqual({ edge: "pass", summary: "ok" });
    });

    it("errors on multiple RESULT shorthand lines", () => {
      const parser = createStreamParser();
      parser.feed("RESULT: pass\n");
      parser.feed("RESULT: fail\n");
      const result = parser.finish();
      expect(result.result?.edge).toBe("pass");
      expect(result.errors.some((e) => /Multiple RESULT/.test(e))).toBe(true);
    });

    it("handles edge with no summary after pipe", () => {
      const parser = createStreamParser();
      parser.feed("RESULT: pass |\n");
      const result = parser.finish();
      expect(result.result).toEqual({ edge: "pass", summary: "" });
    });
  });
});
