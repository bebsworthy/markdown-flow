// test/components/input-prompt-modal.test.tsx
//
// Component tests for `<InputPromptModal>` (P9-T1).

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { buildTheme } from "../../src/theme/theme.js";
import { InputPromptModal } from "../../src/components/input-prompt-modal.js";
import type {
  RunInputRow,
  RunWorkflowResult,
} from "../../src/runStart/types.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

const ENTER = "\r";
const ESC = "\x1b";

function row(partial: Partial<RunInputRow> & Pick<RunInputRow, "key">): RunInputRow {
  return {
    key: partial.key,
    description: partial.description ?? "",
    required: partial.required ?? false,
    placeholder: partial.placeholder ?? "",
    draft: partial.draft ?? "",
  };
}

async function flush(n = 3): Promise<void> {
  for (let i = 0; i < n; i++) {
    await new Promise<void>((r) => setImmediate(r));
  }
}

interface RenderArgs {
  readonly rows: readonly RunInputRow[];
  readonly onSubmit?: (
    inputs: Readonly<Record<string, string>>,
  ) => Promise<RunWorkflowResult>;
  readonly onCancel?: () => void;
}

function renderModal(args: RenderArgs): ReturnType<typeof render> {
  return render(
    <ThemeProvider value={buildTheme({ color: false, unicode: true })}>
      <InputPromptModal
        workflowName="deploy"
        sourceFile="/fake.md"
        rows={args.rows}
        onSubmit={
          args.onSubmit ?? (async () => ({ kind: "ok", runId: "r1" }))
        }
        onCancel={args.onCancel ?? (() => {})}
        width={80}
        height={20}
      />
    </ThemeProvider>,
  );
}

describe("<InputPromptModal>", () => {
  it("renders one row per declared input with `*` on required-empty", () => {
    const out = renderModal({
      rows: [
        row({ key: "env", required: true }),
        row({ key: "version", required: false }),
      ],
    });
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("RUN");
    expect(frame).toContain("deploy");
    expect(frame).toContain("* env");
    expect(frame).toContain("version");
  });

  it("typing updates the draft on the focused row", async () => {
    const out = renderModal({
      rows: [row({ key: "env", required: true })],
    });
    await flush();
    out.stdin.write("p");
    await flush();
    out.stdin.write("r");
    await flush();
    out.stdin.write("d");
    await flush();
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("env = prd");
  });

  it("Enter is a no-op on submit while required row is empty (no onSubmit fire)", async () => {
    const submit = vi.fn(async () => ({ kind: "ok" as const, runId: "r1" }));
    const out = renderModal({
      rows: [row({ key: "env", required: true })],
      onSubmit: submit,
    });
    await flush();
    out.stdin.write(ENTER);
    await flush();
    expect(submit).not.toHaveBeenCalled();
  });

  it("filling required row enables submit; Enter calls onSubmit with composed inputs", async () => {
    const submit = vi.fn(
      async (_inputs: Readonly<Record<string, string>>) => ({
        kind: "ok" as const,
        runId: "r1",
      }),
    );
    const out = renderModal({
      rows: [row({ key: "env", required: true })],
      onSubmit: submit,
    });
    await flush();
    out.stdin.write("p");
    await flush();
    out.stdin.write("r");
    await flush();
    out.stdin.write("d");
    await flush();
    out.stdin.write(ENTER);
    await flush(6);
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]![0]).toEqual({ env: "prd" });
  });

  it("Esc calls onCancel; onSubmit never fires", async () => {
    const submit = vi.fn(async () => ({ kind: "ok" as const, runId: "r1" }));
    const cancel = vi.fn();
    const out = renderModal({
      rows: [row({ key: "env", required: true })],
      onSubmit: submit,
      onCancel: cancel,
    });
    await flush();
    out.stdin.write(ESC);
    await flush();
    expect(cancel).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
  });

  it("locked result keeps modal mounted with retry banner", async () => {
    const submit = vi.fn(
      async () =>
        ({
          kind: "locked",
          runId: "r1",
          lockPath: "/x",
        }) satisfies RunWorkflowResult,
    );
    const cancel = vi.fn();
    const out = renderModal({
      rows: [row({ key: "env", required: true, placeholder: "p" })],
      onSubmit: submit,
      onCancel: cancel,
    });
    await flush();
    out.stdin.write(ENTER);
    await flush(6);
    expect(submit).toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("Run is locked");
  });

  it("no declared inputs → renders an empty placeholder row", () => {
    const out = renderModal({ rows: [] });
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("no declared inputs");
  });
});
