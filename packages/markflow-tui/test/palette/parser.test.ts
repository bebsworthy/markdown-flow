// test/palette/parser.test.ts
import { describe, it, expect } from "vitest";
import { parseInput } from "../../src/palette/parser.js";

describe("palette parseInput", () => {
  it("parses `:run` as head=run, arg empty", () => {
    expect(parseInput(":run")).toEqual({ head: "run", arg: "" });
  });

  it("parses `:run foo bar`", () => {
    expect(parseInput(":run foo bar")).toEqual({
      head: "run",
      arg: "foo bar",
    });
  });

  it("parses bare `:` as empty head/arg", () => {
    expect(parseInput(":")).toEqual({ head: "", arg: "" });
  });

  it("returns null without leading colon", () => {
    expect(parseInput("run")).toBeNull();
    expect(parseInput("")).toBeNull();
  });

  it("tolerates leading/trailing whitespace", () => {
    expect(parseInput("  :run  foo  ")).toEqual({
      head: "run",
      arg: "foo",
    });
  });

  it("collapses multi-space arg to single-space", () => {
    expect(parseInput(":run  foo   bar")).toEqual({
      head: "run",
      arg: "foo bar",
    });
  });
});
