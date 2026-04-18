// test/components/resume-wizard-modal.test.tsx
//
// Component tests for `<ResumeWizardModal>` (P7-T2).

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { buildTheme } from "../../src/theme/theme.js";
import { ResumeWizardModal } from "../../src/components/resume-wizard-modal.js";
import { flush } from "../helpers/flush.js";

import type {
  InputRow,
  RerunNode,
  ResumableRun,
  ResumeSubmitResult,
} from "../../src/resume/types.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

function run(): ResumableRun {
  return {
    runId: "r1",
    workflowName: "deploy",
    status: "error",
    startedAt: "2026-04-17T11:55:00Z",
    lastSeq: 12,
    lastEventLabel: "retry:exhausted at deploy-us",
  };
}

function nodes(): RerunNode[] {
  return [
    {
      nodeId: "deploy-us",
      tokenId: "t-us",
      state: "error",
      summary: "failed",
      preselected: true,
    },
    {
      nodeId: "deploy-eu",
      tokenId: "t-eu",
      state: "complete",
      summary: "complete",
      preselected: false,
    },
  ];
}

function inputs(): InputRow[] {
  return [
    {
      key: "env",
      original: "staging",
      draft: "staging",
      edited: false,
      required: true,
    },
  ];
}
interface RenderArgs {
  readonly rerun?: ReadonlySet<string>;
  readonly inputOverrides?: Readonly<Record<string, string>>;
  readonly onConfirm?: () => Promise<ResumeSubmitResult>;
  readonly onCancel?: () => void;
  readonly onToggleRerun?: (nodeId: string) => void;
  readonly onSetInput?: (key: string, value: string) => void;
}

function renderModal(args: RenderArgs = {}): ReturnType<typeof render> {
  return render(
    <ThemeProvider value={buildTheme({ color: false, unicode: true })}>
      <ResumeWizardModal
        run={run()}
        workflow={null}
        nodes={nodes()}
        inputs={inputs()}
        rerun={args.rerun ?? new Set<string>(["deploy-us"])}
        inputOverrides={args.inputOverrides ?? {}}
        onToggleRerun={args.onToggleRerun ?? (() => {})}
        onSetInput={args.onSetInput ?? (() => {})}
        onConfirm={args.onConfirm ?? (async () => ({ kind: "ok" }))}
        onCancel={args.onCancel ?? (() => {})}
        width={80}
        height={20}
      />
    </ThemeProvider>,
  );
}

describe("<ResumeWizardModal>", () => {
  it("renders title and run metadata verbatim", () => {
    const out = renderModal();
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("RESUME");
    expect(frame).toContain("r1");
    expect(frame).toContain("deploy");
    expect(frame).toContain("retry:exhausted at deploy-us");
    expect(frame).toContain("2026-04-17T11:55:00Z");
  });

  it("preselected node row has [x] glyph; others [ ]", () => {
    const out = renderModal();
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("[x] deploy-us");
    expect(frame).toContain("[ ] deploy-eu");
  });

  it("Space calls onToggleRerun on the cursor row", async () => {
    const onToggleRerun = vi.fn();
    const out = renderModal({ onToggleRerun });
    await flush();
    out.stdin.write(" ");
    await flush();
    expect(onToggleRerun).toHaveBeenCalledWith("deploy-us");
  });

  it("summary line reflects rerun size and edited count", () => {
    const out = renderModal({
      rerun: new Set<string>(["deploy-us", "deploy-eu"]),
      inputOverrides: { env: "prod" },
    });
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("2 re-run");
    expect(frame).toContain("1 input changed");
  });

  it("'edited' annotation appears on rows where draft differs from original", () => {
    const out = renderModal({ inputOverrides: { env: "prod" } });
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("env = prod");
    expect(frame).toContain("edited");
  });

  it("Tab moves focus off `rerun`; Space no longer toggles nodes", async () => {
    const onToggleRerun = vi.fn();
    const out = renderModal({ onToggleRerun });
    await flush();
    out.stdin.write("\t"); // Tab → inputs
    await flush();
    out.stdin.write(" ");
    await flush();
    expect(onToggleRerun).not.toHaveBeenCalled();
  });

  it("Esc calls onCancel", async () => {
    const onCancel = vi.fn();
    const out = renderModal({ onCancel });
    await flush();
    out.stdin.write("\x1b");
    await flush();
    expect(onCancel).toHaveBeenCalled();
  });

  it("Enter calls onConfirm and closes on { kind: 'ok' }", async () => {
    const onConfirm = vi.fn(async () => ({ kind: "ok" as const }));
    const out = renderModal({ onConfirm });
    await flush();
    out.stdin.write("\r");
    await flush(5);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("locked result keeps the modal open with a retry message", async () => {
    const onConfirm = vi.fn(
      async () =>
        ({ kind: "locked", runId: "r1", lockPath: "/x" }) satisfies ResumeSubmitResult,
    );
    const out = renderModal({ onConfirm });
    await flush();
    out.stdin.write("\r");
    await flush(5);
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("Another resume is in progress");
  });

  it("unknownNode result surfaces the specific nodeId", async () => {
    const onConfirm = vi.fn(
      async () => ({ kind: "unknownNode", nodeId: "ghost" }) satisfies ResumeSubmitResult,
    );
    const out = renderModal({ onConfirm });
    await flush();
    out.stdin.write("\r");
    await flush(5);
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("ghost");
  });

  it("while submitting, a second Enter is ignored", async () => {
    let resolve: (v: ResumeSubmitResult) => void = () => {};
    const onConfirm = vi.fn(
      () =>
        new Promise<ResumeSubmitResult>((r) => {
          resolve = r;
        }),
    );
    const out = renderModal({ onConfirm });
    await flush();
    out.stdin.write("\r");
    await flush();
    out.stdin.write("\r");
    await flush();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    resolve({ kind: "ok" });
    await flush();
  });

  it("typing on the focused input row calls onSetInput with updated draft", async () => {
    const onSetInput = vi.fn();
    const out = renderModal({ onSetInput });
    await flush();
    out.stdin.write("\t"); // focus → inputs
    await flush();
    out.stdin.write("X");
    await flush();
    expect(onSetInput).toHaveBeenCalled();
    const lastCall = onSetInput.mock.calls[onSetInput.mock.calls.length - 1]!;
    expect(lastCall[0]).toBe("env");
    expect(lastCall[1].endsWith("X")).toBe(true);
  });
});
