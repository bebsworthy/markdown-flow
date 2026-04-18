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
  archiveShown?: boolean;
  sortKey?: string;
  width?: number;
}) {
  const rendered = render(
    <ThemeProvider>
      <RunsFooter
        shown={props.shown}
        archived={props.archived}
        archiveShown={props.archiveShown ?? false}
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
  it("renders `N shown · M archived · a Show all` when archiveShown=false", () => {
    const { frame, cleanup } = renderFooter({ shown: 5, archived: 9_995 });
    const f = frame();
    expect(f).toContain("5 shown");
    expect(f).toContain("9 995 archived");
    expect(f).toContain("a Show all");
    cleanup();
  });

  it("label flips to `a Hide archived` when archiveShown=true", () => {
    const { frame, cleanup } = renderFooter({
      shown: 10_000,
      archived: 9_995,
      archiveShown: true,
    });
    expect(frame()).toContain("a Hide archived");
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
    // Accept either `1 234` (plain space) or `1\u202F234` (narrow no-break)
    expect(f).toMatch(/1[\s\u202F]234/);
    cleanup();
  });
});

describe("<RunsFooter> — narrow tier", () => {
  it("condenses to `N · M · a Show all` below 90 cols", () => {
    const { frame, cleanup } = renderFooter({
      shown: 3,
      archived: 7,
      width: 80,
    });
    const f = frame();
    expect(f).toContain("a Show all");
    expect(f).not.toContain("shown");
    expect(f).not.toContain("archived");
    cleanup();
  });

  it("narrow tier honours archiveShown label flip", () => {
    const { frame, cleanup } = renderFooter({
      shown: 3,
      archived: 7,
      archiveShown: true,
      width: 80,
    });
    expect(frame()).toContain("a Hide archived");
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
