// Protects against: prototype pollution via step-emitted GLOBAL/LOCAL context.
// The safeMerge function is the sole guard between user-controlled step output
// and Object.prototype contamination. A regression here is a security vulnerability.

import { describe, it, expect } from "vitest";
import { safeMerge } from "../../src/core/safe-merge.js";

describe("safeMerge", () => {
  it("copies simple keys from source to target", () => {
    const target: Record<string, unknown> = { existing: 1 };
    safeMerge(target, { added: 2, another: "three" });
    expect(target).toEqual({ existing: 1, added: 2, another: "three" });
  });

  it("overwrites existing keys in target", () => {
    const target: Record<string, unknown> = { key: "old" };
    safeMerge(target, { key: "new" });
    expect(target.key).toBe("new");
  });

  // Protects against: __proto__ pollution allowing arbitrary prototype injection
  it("blocks __proto__ key from being merged", () => {
    const target: Record<string, unknown> = {};
    const malicious = JSON.parse('{"__proto__": {"isAdmin": true}, "safe": 1}');
    safeMerge(target, malicious);
    expect(target.safe).toBe(1);
    expect(target.__proto__).toBe(Object.prototype);
    expect(({} as any).isAdmin).toBeUndefined();
  });

  // Protects against: constructor pollution via step output
  it("blocks constructor key from being merged", () => {
    const target: Record<string, unknown> = {};
    safeMerge(target, { constructor: "evil", safe: 1 });
    expect(target.safe).toBe(1);
    expect("constructor" in target && target.constructor !== Object).toBe(false);
  });

  // Protects against: prototype key pollution via step output
  it("blocks prototype key from being merged", () => {
    const target: Record<string, unknown> = {};
    safeMerge(target, { prototype: { x: 1 }, safe: 1 });
    expect(target.safe).toBe(1);
    expect(Object.keys(target)).toEqual(["safe"]);
  });

  it("handles empty source gracefully", () => {
    const target: Record<string, unknown> = { a: 1 };
    safeMerge(target, {});
    expect(target).toEqual({ a: 1 });
  });

  it("handles empty target gracefully", () => {
    const target: Record<string, unknown> = {};
    safeMerge(target, { a: 1, b: 2 });
    expect(target).toEqual({ a: 1, b: 2 });
  });

  // Protects against: all three dangerous keys in a single payload
  it("strips all dangerous keys while preserving safe keys in a mixed payload", () => {
    const target: Record<string, unknown> = {};
    // Use Object.create(null) to ensure dangerous keys are real own-properties
    const source = Object.create(null) as Record<string, unknown>;
    source.__proto__ = { hack: true };
    source.constructor = "Evil";
    source.prototype = {};
    source.name = "legit";
    source.value = 42;

    safeMerge(target, source);
    expect(target.name).toBe("legit");
    expect(target.value).toBe(42);
    expect(Object.keys(target).sort()).toEqual(["name", "value"]);
    expect(({} as any).hack).toBeUndefined();
  });
});
