// test/components/approval-modal.test.tsx
//
// Component tests for `<ApprovalModal>` (P7-T1).

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { buildTheme } from "../../src/theme/theme.js";
import { ApprovalModal } from "../../src/components/approval-modal.js";
import type {
  ApprovalSubmitResult,
  PendingApproval,
} from "../../src/approval/types.js";
import { flush } from "../helpers/flush.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

function approval(): PendingApproval {
  return {
    runId: "r1",
    nodeId: "review",
    tokenId: "t1",
    prompt: "Approve deploy?",
    options: ["approve", "reject"],
    waitingSeq: 1,
  };
}

function renderModal(args: {
  onDecide?: (choice: string) => Promise<ApprovalSubmitResult>;
  onSuspend?: () => void;
  onCancel?: () => void;
}): ReturnType<typeof render> {
  return render(
    <ThemeProvider value={buildTheme({ color: false, unicode: true })}>
      <ApprovalModal
        approval={approval()}
        onDecide={args.onDecide ?? (async () => ({ kind: "ok" }))}
        onSuspend={args.onSuspend ?? (() => {})}
        onCancel={args.onCancel ?? (() => {})}
        visible={true}
      />
    </ThemeProvider>,
  );
}

describe("<ApprovalModal>", () => {
  it("renders prompt verbatim and shows both options", () => {
    const out = renderModal({});
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("Approve deploy?");
    expect(frame).toContain("approve");
    expect(frame).toContain("reject");
    expect(frame).toContain("APPROVAL \u00b7 review");
  });

  it("radio glyphs: cursor row gets filled circle, others empty", () => {
    const out = renderModal({});
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toMatch(/\u25c9 approve/);
    expect(frame).toMatch(/\u25cb reject/);
  });

  it("down-arrow moves the cursor to next option", async () => {
    const out = renderModal({});
    await flush();
    out.stdin.write("\x1b[B"); // Down arrow
    await flush();
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toMatch(/\u25cb approve/);
    expect(frame).toMatch(/\u25c9 reject/);
  });

  it("cursor wraps at the end", async () => {
    const out = renderModal({});
    await flush();
    out.stdin.write("\x1b[B");
    out.stdin.write("\x1b[B"); // Two downs with 2 options → back to start
    await flush();
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toMatch(/\u25c9 approve/);
  });

  it("Enter calls onDecide with options[cursor]", async () => {
    const onDecide = vi.fn(async () => ({ kind: "ok" as const }));
    const onSuspend = vi.fn();
    const out = renderModal({ onDecide, onSuspend });
    await flush();
    out.stdin.write("\r");
    await flush(5);
    expect(onDecide).toHaveBeenCalledWith("approve");
    expect(onSuspend).toHaveBeenCalled();
  });

  it("s triggers onSuspend", async () => {
    const onSuspend = vi.fn();
    const out = renderModal({ onSuspend });
    await flush();
    out.stdin.write("s");
    await flush();
    expect(onSuspend).toHaveBeenCalled();
  });

  it("Esc triggers onCancel", async () => {
    const onCancel = vi.fn();
    const out = renderModal({ onCancel });
    await flush();
    out.stdin.write("\x1b");
    await flush();
    expect(onCancel).toHaveBeenCalled();
  });

  it("while submitting, Enter is ignored and button reads Deciding…", async () => {
    let resolve: (v: ApprovalSubmitResult) => void = () => {};
    const onDecide = vi.fn(
      () =>
        new Promise<ApprovalSubmitResult>((r) => {
          resolve = r;
        }),
    );
    const onSuspend = vi.fn();
    const out = renderModal({ onDecide, onSuspend });
    await flush();
    out.stdin.write("\r");
    await flush();
    expect(onDecide).toHaveBeenCalledTimes(1);
    // Second Enter while submitting should be ignored.
    out.stdin.write("\r");
    await flush();
    expect(onDecide).toHaveBeenCalledTimes(1);
    const midFrame = stripAnsi(out.lastFrame() ?? "");
    expect(midFrame).toContain("Deciding");
    resolve({ kind: "ok" });
    await flush();
    expect(onSuspend).toHaveBeenCalled();
  });

  it("error result surfaces message beneath the buttons", async () => {
    const onDecide = vi.fn(
      async () =>
        ({ kind: "error", message: "boom" }) satisfies ApprovalSubmitResult,
    );
    const onSuspend = vi.fn();
    const out = renderModal({ onDecide, onSuspend });
    await flush();
    out.stdin.write("\r");
    await flush(5);
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("boom");
    expect(onSuspend).not.toHaveBeenCalled();
  });

  it("locked result keeps the modal open with a retry hint", async () => {
    const onDecide = vi.fn(
      async () =>
        ({ kind: "locked", runId: "r1", lockPath: "/lock" }) satisfies
        ApprovalSubmitResult,
    );
    const onSuspend = vi.fn();
    const out = renderModal({ onDecide, onSuspend });
    await flush();
    out.stdin.write("\r");
    await flush(5);
    const frame = stripAnsi(out.lastFrame() ?? "");
    expect(frame).toContain("Another approve is in progress");
    expect(onSuspend).not.toHaveBeenCalled();
  });
});
