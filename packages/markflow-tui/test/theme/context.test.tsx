// test/theme/context.test.tsx
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { ThemeProvider, useTheme } from "../../src/theme/context.js";
import { buildTheme } from "../../src/theme/theme.js";

function Probe(): React.ReactElement {
  const t = useTheme();
  return (
    <Text>
      {`${t.capabilities.color}:${t.capabilities.unicode}:${t.glyphs.ok}`}
    </Text>
  );
}

describe("useTheme", () => {
  it("reads the explicit theme passed via value (ASCII + mono)", () => {
    const { lastFrame } = render(
      <ThemeProvider value={buildTheme({ color: false, unicode: false })}>
        <Probe />
      </ThemeProvider>,
    );
    expect(lastFrame()).toBe("false:false:[ok]");
  });

  it("reads the unicode table when capabilities.unicode=true", () => {
    const { lastFrame } = render(
      <ThemeProvider value={buildTheme({ color: true, unicode: true })}>
        <Probe />
      </ThemeProvider>,
    );
    expect(lastFrame()).toBe("true:true:✓");
  });

  it("throws when used outside a provider", () => {
    // Ink's error boundary catches render-time throws and funnels them
    // to stderr rather than re-raising. Silence React's boundary log
    // noise and read the caught error via a ref we populate in a custom
    // component that consumes useTheme within a try/catch at render.
    let caught: Error | null = null;
    function Catcher(): React.ReactElement {
      try {
        useTheme();
        return <Text>no-throw</Text>;
      } catch (e) {
        caught = e as Error;
        return <Text>caught</Text>;
      }
    }
    render(<Catcher />);
    expect(caught).not.toBeNull();
    expect((caught as unknown as Error).message).toMatch(
      /no <ThemeProvider>/,
    );
  });
});
