import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { SplitPane } from "../../src/primitives/SplitPane.js";
import { Text, Box } from "ink";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

function renderSplit(
  props: Partial<React.ComponentProps<typeof SplitPane>> & {
    children: [React.ReactNode, React.ReactNode];
  },
) {
  return render(
    <ThemeProvider>
      <SplitPane {...props} />
    </ThemeProvider>,
  );
}

describe("SplitPane", () => {
  it("renders both children", () => {
    const { lastFrame } = renderSplit({
      direction: "column",
      width: 40,
      height: 6,
      children: [<Text key="a">LEFT</Text>, <Text key="b">RIGHT</Text>],
    });
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("LEFT");
    expect(frame).toContain("RIGHT");
  });

  it("row direction at width=100 with ratio=0.55 gives ~55/45 split", () => {
    const { lastFrame } = renderSplit({
      direction: "row",
      ratio: 0.55,
      width: 100,
      height: 1,
      children: [
        <Box key="a" width="100%">
          <Text>{"A".repeat(100)}</Text>
        </Box>,
        <Box key="b" width="100%">
          <Text>{"B".repeat(100)}</Text>
        </Box>,
      ],
    });
    const frame = stripAnsi(lastFrame() ?? "");
    const line = frame.split("\n")[0] ?? "";
    const aCount = (line.match(/A/g) ?? []).length;
    const bCount = (line.match(/B/g) ?? []).length;
    expect(aCount).toBeGreaterThanOrEqual(50);
    expect(aCount).toBeLessThanOrEqual(60);
    expect(bCount).toBeGreaterThanOrEqual(40);
    expect(bCount).toBeLessThanOrEqual(50);
  });

  it("divider renders a separator character between children", () => {
    const { lastFrame } = renderSplit({
      direction: "row",
      ratio: 0.5,
      divider: true,
      width: 40,
      height: 3,
      children: [<Text key="a">FIRST</Text>, <Text key="b">SECOND</Text>],
    });
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("FIRST");
    expect(frame).toContain("SECOND");
    // Divider renders a vertical border character (║ or |)
    const hasVerticalBorder = frame.includes("║") || frame.includes("|");
    expect(hasVerticalBorder).toBe(true);
  });

  it("column direction with divider renders both children in order", () => {
    const { lastFrame } = renderSplit({
      direction: "column",
      ratio: 0.5,
      divider: true,
      width: 20,
      height: 6,
      children: [<Text key="a">TOP</Text>, <Text key="b">BOTTOM</Text>],
    });
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("TOP");
    expect(frame).toContain("BOTTOM");
    const topIdx = frame.indexOf("TOP");
    const bottomIdx = frame.indexOf("BOTTOM");
    expect(topIdx).toBeLessThan(bottomIdx);
  });

  it("no divider when divider prop is false", () => {
    const { lastFrame } = renderSplit({
      direction: "row",
      ratio: 0.5,
      divider: false,
      width: 40,
      height: 3,
      children: [<Text key="a">AAA</Text>, <Text key="b">BBB</Text>],
    });
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).not.toContain("║");
    expect(frame).not.toContain("|");
  });
});
