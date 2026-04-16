// test/theme/capabilities.test.ts
import { describe, it, expect } from "vitest";
import { detectCapabilities } from "../../src/theme/capabilities.js";

describe("detectCapabilities", () => {
  it("empty env + TTY → color on, unicode off (conservative default)", () => {
    const caps = detectCapabilities({}, { stdoutIsTTY: true });
    expect(caps.color).toBe(true);
    expect(caps.unicode).toBe(false);
  });

  it("empty env + non-TTY → both off", () => {
    const caps = detectCapabilities({}, { stdoutIsTTY: false });
    expect(caps.color).toBe(false);
    expect(caps.unicode).toBe(false);
  });

  it("empty env + stdoutIsTTY omitted → both off (default false)", () => {
    const caps = detectCapabilities({});
    expect(caps.color).toBe(false);
    expect(caps.unicode).toBe(false);
  });

  it("NO_COLOR=1 disables color (acceptance criterion)", () => {
    const caps = detectCapabilities(
      { NO_COLOR: "1" },
      { stdoutIsTTY: true },
    );
    expect(caps.color).toBe(false);
  });

  it("NO_COLOR='' is treated as unset (spec: empty = not set)", () => {
    const caps = detectCapabilities(
      { NO_COLOR: "" },
      { stdoutIsTTY: true },
    );
    expect(caps.color).toBe(true);
  });

  it("NO_COLOR with any non-empty value disables color", () => {
    const caps = detectCapabilities(
      { NO_COLOR: "true" },
      { stdoutIsTTY: true },
    );
    expect(caps.color).toBe(false);
  });

  it("TERM=dumb disables color", () => {
    const caps = detectCapabilities(
      { TERM: "dumb" },
      { stdoutIsTTY: true },
    );
    expect(caps.color).toBe(false);
  });

  it("MARKFLOW_ASCII=1 forces ASCII (acceptance criterion)", () => {
    const caps = detectCapabilities(
      { MARKFLOW_ASCII: "1", LANG: "en_US.UTF-8" },
      { stdoutIsTTY: true },
    );
    // color stays on; unicode is forced off
    expect(caps.color).toBe(true);
    expect(caps.unicode).toBe(false);
  });

  it("MARKFLOW_ASCII=1 + NO_COLOR=1 disables both", () => {
    const caps = detectCapabilities(
      { MARKFLOW_ASCII: "1", NO_COLOR: "1" },
      { stdoutIsTTY: true },
    );
    expect(caps.color).toBe(false);
    expect(caps.unicode).toBe(false);
  });

  it("LANG=en_US.UTF-8 enables unicode (canonical form)", () => {
    const caps = detectCapabilities(
      { LANG: "en_US.UTF-8" },
      { stdoutIsTTY: true },
    );
    expect(caps.unicode).toBe(true);
  });

  it("LANG=en_US.UTF8 enables unicode (tolerant regex)", () => {
    const caps = detectCapabilities(
      { LANG: "en_US.UTF8" },
      { stdoutIsTTY: true },
    );
    expect(caps.unicode).toBe(true);
  });

  it("LANG=en_US.utf-8 enables unicode (case insensitive)", () => {
    const caps = detectCapabilities(
      { LANG: "en_US.utf-8" },
      { stdoutIsTTY: true },
    );
    expect(caps.unicode).toBe(true);
  });

  it("LANG=C leaves unicode off", () => {
    const caps = detectCapabilities(
      { LANG: "C" },
      { stdoutIsTTY: true },
    );
    expect(caps.unicode).toBe(false);
  });

  it("UTF-8 locale + non-TTY → both off", () => {
    const caps = detectCapabilities(
      { LANG: "en_US.UTF-8" },
      { stdoutIsTTY: false },
    );
    expect(caps.color).toBe(false);
    expect(caps.unicode).toBe(false);
  });

  it("LC_ALL takes precedence over LANG", () => {
    const caps = detectCapabilities(
      { LC_ALL: "en_US.UTF-8", LANG: "C" },
      { stdoutIsTTY: true },
    );
    expect(caps.unicode).toBe(true);
  });

  it("LC_CTYPE is honored when LC_ALL is missing", () => {
    const caps = detectCapabilities(
      { LC_CTYPE: "en_US.UTF-8" },
      { stdoutIsTTY: true },
    );
    expect(caps.unicode).toBe(true);
  });

  it("MARKFLOW_ASCII wins over a UTF-8 locale", () => {
    const caps = detectCapabilities(
      { LANG: "en_US.UTF-8", MARKFLOW_ASCII: "1" },
      { stdoutIsTTY: true },
    );
    expect(caps.unicode).toBe(false);
  });

  it("returns a frozen object", () => {
    const caps = detectCapabilities({}, { stdoutIsTTY: true });
    expect(Object.isFrozen(caps)).toBe(true);
  });
});
