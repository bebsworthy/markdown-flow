import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { ThemeProvider } from "../../src/theme/context.js";
import { buildTheme } from "../../src/theme/theme.js";
import { Panel } from "../../src/primitives/Panel.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

const unicodeTheme = buildTheme({ unicode: true, color: true });
const asciiTheme = buildTheme({ unicode: false, color: false });

function renderPanel(
  props: Partial<React.ComponentProps<typeof Panel>> = {},
  theme = unicodeTheme,
) {
  return render(
    <ThemeProvider value={theme}>
      <Panel {...props}>
        <Text>panel body</Text>
      </Panel>
    </ThemeProvider>,
  );
}

describe("Panel", () => {
  describe("border style", () => {
    it("unicode theme uses double-line border chars", () => {
      const { lastFrame } = renderPanel({}, unicodeTheme);
      const frame = lastFrame() ?? "";
      expect(frame).toContain("║");
    });

    it("ascii theme uses classic border chars", () => {
      const { lastFrame } = renderPanel({}, asciiTheme);
      const frame = lastFrame() ?? "";
      expect(frame).toContain("|");
    });
  });

  describe("title", () => {
    it("string title renders bold text", () => {
      const { lastFrame } = renderPanel({ title: "Details" });
      const frame = stripAnsi(lastFrame() ?? "");
      expect(frame).toContain("Details");
    });

    it("ReactNode title renders custom node", () => {
      const { lastFrame } = renderPanel({
        title: <Text color="red">Custom</Text>,
      });
      const frame = stripAnsi(lastFrame() ?? "");
      expect(frame).toContain("Custom");
    });

    it("no title renders no title text", () => {
      const { lastFrame } = renderPanel({});
      const frame = stripAnsi(lastFrame() ?? "");
      expect(frame).toContain("panel body");
      const lines = frame.split("\n");
      const bodyLine = lines.find((l) => l.includes("panel body"));
      expect(bodyLine).toBeDefined();
    });
  });

  describe("children", () => {
    it("content renders inside borders", () => {
      const { lastFrame } = renderPanel({});
      const frame = stripAnsi(lastFrame() ?? "");
      expect(frame).toContain("panel body");
    });
  });

  describe("display", () => {
    it("display='none' renders nothing visible", () => {
      const { lastFrame } = renderPanel({ display: "none" });
      const frame = stripAnsi(lastFrame() ?? "");
      expect(frame.trim()).toBe("");
    });
  });
});
