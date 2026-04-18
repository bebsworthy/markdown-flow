import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { ThemeProvider } from "../../src/theme/context.js";
import { Modal } from "../../src/primitives/Modal.js";
import { flush } from "../helpers/flush.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

function renderModal(props: Partial<React.ComponentProps<typeof Modal>> = {}) {
  return render(
    <ThemeProvider>
      <Modal visible={true} {...props}>
        <Text>modal content</Text>
      </Modal>
    </ThemeProvider>,
  );
}

describe("Modal", () => {
  describe("visibility", () => {
    it("visible=false renders empty", () => {
      const { lastFrame } = renderModal({ visible: false });
      const frame = stripAnsi(lastFrame() ?? "");
      expect(frame.trim()).toBe("");
    });

    it("visible=true renders content", () => {
      const { lastFrame } = renderModal({ visible: true });
      const frame = stripAnsi(lastFrame() ?? "");
      expect(frame).toContain("modal content");
    });
  });

  describe("escape key", () => {
    it("onClose provided — Esc calls it", async () => {
      const onClose = vi.fn();
      const { stdin } = renderModal({ visible: true, onClose });
      stdin.write("\x1b");
      await flush();
      expect(onClose).toHaveBeenCalled();
    });

    it("no onClose — Esc does not crash", async () => {
      const { stdin } = renderModal({ visible: true });
      stdin.write("\x1b");
      await flush();
    });
  });

  describe("title", () => {
    it("title renders in the panel", () => {
      const { lastFrame } = renderModal({ visible: true, title: "My Title" });
      const frame = stripAnsi(lastFrame() ?? "");
      expect(frame).toContain("My Title");
    });
  });
});
