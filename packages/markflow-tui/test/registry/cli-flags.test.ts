// test/registry/cli-flags.test.ts
//
// Unit tests for `parseRegistryFlags` (P4-T1 §6.4). Pure — no process
// access, no fs. The parser is the argv → config mapping; resolving the
// config into an absolute registry path is `resolveRegistryPath`'s job.

import { describe, it, expect } from "vitest";
import { parseRegistryFlags } from "../../src/cli-args.js";

describe("parseRegistryFlags", () => {
  it("no args → listPath=null, persist=true, rest=[]", () => {
    const out = parseRegistryFlags([]);
    expect(out.config).toEqual({ listPath: null, persist: true });
    expect(out.rest).toEqual([]);
  });

  it("--no-save → listPath=null, persist=false", () => {
    const out = parseRegistryFlags(["--no-save"]);
    expect(out.config).toEqual({ listPath: null, persist: false });
    expect(out.rest).toEqual([]);
  });

  it("--list /x.json → listPath='/x.json', persist=true", () => {
    const out = parseRegistryFlags(["--list", "/x.json"]);
    expect(out.config).toEqual({ listPath: "/x.json", persist: true });
    expect(out.rest).toEqual([]);
  });

  it("--list=/x.json (equals form) → listPath='/x.json', persist=true", () => {
    const out = parseRegistryFlags(["--list=/x.json"]);
    expect(out.config).toEqual({ listPath: "/x.json", persist: true });
  });

  it("--list X --no-save → listPath=null, persist=false (no-save wins)", () => {
    const out = parseRegistryFlags(["--list", "X", "--no-save"]);
    expect(out.config).toEqual({ listPath: null, persist: false });
  });

  it("--no-save --list X → same result regardless of order", () => {
    const out = parseRegistryFlags(["--no-save", "--list", "X"]);
    expect(out.config).toEqual({ listPath: null, persist: false });
  });

  it("unknown positional args pass through to rest", () => {
    const out = parseRegistryFlags(["foo.md", "bar.md"]);
    expect(out.rest).toEqual(["foo.md", "bar.md"]);
  });

  it("--list missing value: throws a typed error", () => {
    expect(() => parseRegistryFlags(["--list"])).toThrow(
      "--list requires a path argument",
    );
  });

  it("--list followed by another flag: throws (value was the next flag)", () => {
    expect(() => parseRegistryFlags(["--list", "--no-save"])).toThrow(
      "--list requires a path argument",
    );
  });

  it("repeated --list: last value wins", () => {
    const out = parseRegistryFlags(["--list", "first.json", "--list", "second.json"]);
    expect(out.config.listPath).toBe("second.json");
  });

  it("mixes flags and positionals: positional order preserved in rest", () => {
    const out = parseRegistryFlags(["--list", "X", "foo.md", "bar.md"]);
    expect(out.config.listPath).toBe("X");
    expect(out.rest).toEqual(["foo.md", "bar.md"]);
  });
});
