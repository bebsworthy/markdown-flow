// test/log/ansi.test.ts

import { describe, it, expect } from "vitest";
import { parseAnsi, stripAnsi } from "../../src/log/ansi.js";

describe("parseAnsi", () => {
  it("returns a single plain segment for text without escapes", () => {
    const { segments } = parseAnsi("hello world");
    expect(segments.length).toBe(1);
    expect(segments[0]!.text).toBe("hello world");
    expect(segments[0]!.color).toBeUndefined();
  });

  it("parses SGR fg colors (30-37)", () => {
    const { segments } = parseAnsi("\x1b[31mred\x1b[0m done");
    expect(segments[0]!.text).toBe("red");
    expect(segments[0]!.color).toBe("red");
    expect(segments[1]!.text).toBe(" done");
    expect(segments[1]!.color).toBeUndefined();
  });

  it("parses bright fg colors (90-97)", () => {
    const { segments } = parseAnsi("\x1b[94mblue\x1b[0m");
    expect(segments[0]!.color).toBe("brightBlue");
  });

  it("parses 256-color SGR (38;5;N)", () => {
    const { segments } = parseAnsi("\x1b[38;5;200mx\x1b[0m");
    expect(segments[0]!.color).toEqual({ kind: "256", index: 200 });
  });

  it("parses truecolor SGR (38;2;r;g;b)", () => {
    const { segments } = parseAnsi("\x1b[38;2;10;20;30mrgb\x1b[0m");
    expect(segments[0]!.color).toEqual({ kind: "rgb", r: 10, g: 20, b: 30 });
  });

  it("tracks bold/dim/italic/underline", () => {
    const { segments } = parseAnsi(
      "\x1b[1mB\x1b[2mD\x1b[3mI\x1b[4mU\x1b[0mend",
    );
    expect(segments[0]!.bold).toBe(true);
    expect(segments[1]!.bold).toBe(true);
    expect(segments[1]!.dim).toBe(true);
    expect(segments[2]!.italic).toBe(true);
    expect(segments[3]!.underline).toBe(true);
    expect(segments[4]!.bold).toBeUndefined();
  });

  it("handles empty SGR as a reset (\\x1b[m)", () => {
    const { segments } = parseAnsi("\x1b[31mx\x1b[my");
    expect(segments[0]!.color).toBe("red");
    expect(segments[1]!.color).toBeUndefined();
  });

  it("carries SGR state across chunks via `initial`", () => {
    const first = parseAnsi("\x1b[31mhello");
    expect(first.final.color).toBe("red");
    const second = parseAnsi(" world\x1b[0m", first.final);
    expect(second.segments[0]!.color).toBe("red");
  });

  it("strips OSC sequences (\\x1b]…\\x07)", () => {
    const { segments } = parseAnsi("before\x1b]0;title\x07after");
    expect(segments.map((s) => s.text).join("")).toBe("beforeafter");
  });

  it("strips cursor-move CSI sequences", () => {
    const { segments } = parseAnsi("a\x1b[Hb\x1b[2Jc");
    expect(segments.map((s) => s.text).join("")).toBe("abc");
  });

  it("strips ESC-only sequences", () => {
    const { segments } = parseAnsi("a\x1bDb");
    expect(segments.map((s) => s.text).join("")).toBe("ab");
  });

  it("drops unknown SGR codes without throwing", () => {
    const { segments } = parseAnsi("\x1b[999mx\x1b[0m");
    expect(segments[0]!.text).toBe("x");
  });

  it("22 clears bold+dim, 23 clears italic, 24 clears underline", () => {
    const { segments } = parseAnsi("\x1b[1;2;3;4mx\x1b[22my\x1b[23mz\x1b[24m!");
    expect(segments[0]!.bold).toBe(true);
    expect(segments[1]!.bold).toBeUndefined();
    expect(segments[1]!.italic).toBe(true);
    expect(segments[2]!.italic).toBeUndefined();
    expect(segments[3]!.underline).toBeUndefined();
  });

  it("39 resets fg color only; 49 resets bg only", () => {
    const { segments } = parseAnsi("\x1b[31;41mx\x1b[39my\x1b[49mz");
    expect(segments[0]!.color).toBe("red");
    expect(segments[0]!.bgColor).toBe("red");
    expect(segments[1]!.color).toBeUndefined();
    expect(segments[1]!.bgColor).toBe("red");
    expect(segments[2]!.bgColor).toBeUndefined();
  });
});

describe("stripAnsi", () => {
  it("strips colors", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
  });

  it("strips OSC + cursor + ESC-only", () => {
    expect(stripAnsi("a\x1b]0;t\x07b\x1b[Hc\x1bDd")).toBe("abcd");
  });

  it("is a no-op for plain text", () => {
    expect(stripAnsi("plain")).toBe("plain");
  });
});
