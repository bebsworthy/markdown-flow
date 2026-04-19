// test/components/runs-footer.test.tsx
//
// Footer rendering tests (P5-T2 §10.7).

import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { RunsFooter } from "../../src/components/runs-footer.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

function renderFooter(props: {
  shown: number;
  archived: number;
  sortKey?: string;
  width?: number;
}) {
  const rendered = render(
    <ThemeProvider>
      <RunsFooter
        shown={props.shown}
        archived={props.archived}
        sortKey={props.sortKey ?? "attention"}
        width={props.width ?? 140}
      />
    </ThemeProvider>,
  );
  return {
    frame: () => stripAnsi(rendered.lastFrame() ?? ""),
    cleanup: () => rendered.unmount(),
  };
}

describe("<RunsFooter> — wide tier", () => {
  it("renders `N shown · M archived` counts", () => {
    const { frame, cleanup } = renderFooter({ shown: 5, archived: 9_995 });
    const f = frame();
    expect(f).toContain("5 shown");
    expect(f).toContain("9 995 archived");
    cleanup();
  });

  it("does not render shortcut hints (owned by keybar)", () => {
    const { frame, cleanup } = renderFooter({ shown: 5, archived: 3 });
    const f = frame();
    expect(f).not.toContain("a Show");
    expect(f).not.toContain("a Hide");
    cleanup();
  });

  it("zero archived still renders `0 archived`", () => {
    const { frame, cleanup } = renderFooter({ shown: 3, archived: 0 });
    expect(frame()).toContain("0 archived");
    cleanup();
  });

  it("zero shown renders `0 shown`", () => {
    const { frame, cleanup } = renderFooter({ shown: 0, archived: 2 });
    expect(frame()).toContain("0 shown");
    cleanup();
  });

  it("thousands use a space separator (accepting either narrow or normal)", () => {
    const { frame, cleanup } = renderFooter({ shown: 1234, archived: 0 });
    const f = frame();
    expect(f).toMatch(/1[\s\u202F]234/);
    cleanup();
  });
});

describe("<RunsFooter> — narrow tier", () => {
  it("condenses labels below 90 cols", () => {
    const { frame, cleanup } = renderFooter({
      shown: 3,
      archived: 7,
      width: 80,
    });
    const f = frame();
    expect(f).toContain("3");
    expect(f).toContain("7 archived");
    expect(f).not.toContain("shown");
    cleanup();
  });
});

describe("<RunsFooter> — purity", () => {
  it("deterministic: same props yield same frame", () => {
    const a = renderFooter({ shown: 42, archived: 17 });
    const b = renderFooter({ shown: 42, archived: 17 });
    expect(a.frame()).toBe(b.frame());
    a.cleanup();
    b.cleanup();
  });
});
