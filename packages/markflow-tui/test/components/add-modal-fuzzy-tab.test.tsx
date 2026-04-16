// test/components/add-modal-fuzzy-tab.test.tsx
//
// Pure rendering tests for `<AddModalFuzzyTab>`. The component owns no
// input — the parent modal routes every key and passes down all display
// state — so these tests exercise only what is visible in the frame.

import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { AddModalFuzzyTab } from "../../src/components/add-modal-fuzzy-tab.js";
import type {
  Candidate,
  RankedCandidate,
  ValidationResult,
} from "../../src/add-modal/types.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

function ranked(
  displayPath: string,
  kind: "file" | "workspace" = "file",
  absolutePath = displayPath,
  score = 10,
): RankedCandidate {
  const candidate: Candidate = { kind, absolutePath, displayPath, depth: 1 };
  return { candidate, score, matchPositions: [] };
}

interface Props {
  root?: string;
  query?: string;
  ranked?: ReadonlyArray<RankedCandidate>;
  selectedIndex?: number;
  visibleLimit?: number;
  walkerTruncated?: boolean;
  candidateCount?: number;
  validationByPath?: ReadonlyMap<string, ValidationResult>;
  rootPickerOpen?: boolean;
  rootPickerDraft?: string;
  rootPickerError?: string | null;
  width?: number;
}

function renderTab(p: Props = {}): string {
  const { lastFrame } = render(
    <ThemeProvider>
      <AddModalFuzzyTab
        root={p.root ?? "/abs/root"}
        query={p.query ?? ""}
        ranked={p.ranked ?? []}
        selectedIndex={p.selectedIndex ?? 0}
        visibleLimit={p.visibleLimit ?? 10}
        walkerTruncated={p.walkerTruncated ?? false}
        candidateCount={p.candidateCount ?? 0}
        validationByPath={p.validationByPath ?? new Map()}
        rootPickerOpen={p.rootPickerOpen ?? false}
        rootPickerDraft={p.rootPickerDraft ?? ""}
        rootPickerError={p.rootPickerError ?? null}
        width={p.width ?? 70}
      />
    </ThemeProvider>,
  );
  return stripAnsi(lastFrame() ?? "");
}

describe("AddModalFuzzyTab — idle / scanning", () => {
  it("shows the current root and the root-picker hint", () => {
    const frame = renderTab({ root: "/home/me/workflows" });
    expect(frame).toContain("root:");
    expect(frame).toContain("/home/me/workflows");
    expect(frame).toContain("Ctrl+Up to change");
  });

  it("renders '(scanning…)' when the walker has found nothing yet", () => {
    const frame = renderTab({ candidateCount: 0, query: "" });
    expect(frame).toContain("(scanning");
  });

  it("renders '(type to filter)' once candidates exist and query is empty", () => {
    const frame = renderTab({ candidateCount: 42, query: "" });
    expect(frame).toContain("(type to filter)");
  });

  it("renders '(no matches)' when the query eliminates all rows", () => {
    const frame = renderTab({ candidateCount: 42, query: "zzz" });
    expect(frame).toContain("(no matches)");
  });
});

describe("AddModalFuzzyTab — result list", () => {
  it("renders one row per ranked entry with displayPath and a [file] or [workspace] badge", () => {
    const rows = [
      ranked("./alpha.md", "file"),
      ranked("./workspaces/beta", "workspace"),
    ];
    const frame = renderTab({ ranked: rows, query: "a" });
    expect(frame).toContain("./alpha.md");
    expect(frame).toContain("./workspaces/beta");
    expect(frame).toContain("[file]");
    expect(frame).toContain("[workspace]");
  });

  it("puts the ▶ cursor only on the selected row", () => {
    const rows = [ranked("./a.md"), ranked("./b.md"), ranked("./c.md")];
    const frame = renderTab({ ranked: rows, selectedIndex: 1 });
    const lines = frame.split("\n");
    const withArrow = lines.filter((l) => l.includes("\u25b6"));
    expect(withArrow).toHaveLength(1);
    expect(withArrow[0]).toContain("./b.md");
  });

  it("clamps the visible list at `visibleLimit` rows", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      ranked(`./row-${i.toString().padStart(2, "0")}.md`),
    );
    const frame = renderTab({ ranked: rows, visibleLimit: 5 });
    expect(frame).toContain("./row-00.md");
    expect(frame).toContain("./row-04.md");
    expect(frame).not.toContain("./row-05.md");
  });

  it("marks parse-error files with the bad badge text", () => {
    const rows = [ranked("./broken.md", "file")];
    const validation = new Map<string, ValidationResult>([
      ["./broken.md", { kind: "file-parse-error", message: "syntax" }],
    ]);
    const frame = renderTab({
      ranked: rows,
      validationByPath: validation,
    });
    expect(frame).toContain("\u2717 parse");
  });

  it("renders the truncated footer when walkerTruncated=true", () => {
    const rows = [ranked("./x.md")];
    const frame = renderTab({
      ranked: rows,
      walkerTruncated: true,
      candidateCount: 500,
    });
    expect(frame).toMatch(/showing 500\/500\+ .* refine/);
  });
});

describe("AddModalFuzzyTab — root picker", () => {
  it("swaps the root line for the picker draft when rootPickerOpen=true", () => {
    const frame = renderTab({
      rootPickerOpen: true,
      rootPickerDraft: "/tmp/new-root",
    });
    expect(frame).toContain("/tmp/new-root");
    expect(frame).toContain("Enter to confirm");
    // The hint line for picking root should not be shown while open.
    expect(frame).not.toContain("Ctrl+Up to change");
  });

  it("shows the root picker error underneath the draft when provided", () => {
    const frame = renderTab({
      rootPickerOpen: true,
      rootPickerDraft: "/does/not/exist",
      rootPickerError: "path not found",
    });
    expect(frame).toContain("path not found");
  });
});
