import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { TextInput } from "../../src/primitives/TextInput.js";
import { flush } from "../helpers/flush.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

function renderInput(props: Partial<React.ComponentProps<typeof TextInput>> = {}) {
  const onChange = props.onChange ?? vi.fn();
  return render(
    <ThemeProvider>
      <TextInput value="" onChange={onChange} {...props} />
    </ThemeProvider>,
  );
}

describe("TextInput", () => {
  describe("character input", () => {
    it("typing appends to value", async () => {
      const onChange = vi.fn();
      const { stdin } = renderInput({ value: "he", onChange });
      stdin.write("l");
      await flush();
      expect(onChange).toHaveBeenCalledWith("hel");
    });

    it("ctrl keys do not append", async () => {
      const onChange = vi.fn();
      const { stdin } = renderInput({ value: "hi", onChange });
      stdin.write("\x01"); // Ctrl+A
      await flush();
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("backspace", () => {
    it("removes last character", async () => {
      const onChange = vi.fn();
      const { stdin } = renderInput({ value: "abc", onChange });
      stdin.write("\x7f");
      await flush();
      expect(onChange).toHaveBeenCalledWith("ab");
    });

    it("empty string stays empty", async () => {
      const onChange = vi.fn();
      const { stdin } = renderInput({ value: "", onChange });
      stdin.write("\x7f");
      await flush();
      expect(onChange).toHaveBeenCalledWith("");
    });
  });

  describe("submit and cancel", () => {
    it("Enter calls onSubmit", async () => {
      const onSubmit = vi.fn();
      const { stdin } = renderInput({ value: "test", onSubmit });
      stdin.write("\r");
      await flush();
      expect(onSubmit).toHaveBeenCalledWith("test");
    });

    it("Escape calls onCancel", async () => {
      const onCancel = vi.fn();
      const { stdin } = renderInput({ value: "test", onCancel });
      stdin.write("\x1b");
      await flush();
      expect(onCancel).toHaveBeenCalled();
    });

    it("missing onSubmit does not crash", async () => {
      const { stdin } = renderInput({ value: "x" });
      stdin.write("\r");
      await flush();
    });

    it("missing onCancel does not crash", async () => {
      const { stdin } = renderInput({ value: "x" });
      stdin.write("\x1b");
      await flush();
    });
  });

  describe("Ctrl+U", () => {
    it("ctrlUClears=true clears value", async () => {
      const onChange = vi.fn();
      const { stdin } = renderInput({ value: "hello", onChange, ctrlUClears: true });
      stdin.write("\x15");
      await flush();
      expect(onChange).toHaveBeenCalledWith("");
    });

    it("ctrlUClears=false does not clear", async () => {
      const onChange = vi.fn();
      const { stdin } = renderInput({ value: "hello", onChange, ctrlUClears: false });
      stdin.write("\x15");
      await flush();
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("isActive", () => {
    it("false ignores typing", async () => {
      const onChange = vi.fn();
      const { stdin } = renderInput({ value: "", onChange, isActive: false });
      stdin.write("a");
      await flush();
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("placeholder", () => {
    it("shown when value is empty", () => {
      const { lastFrame } = renderInput({ value: "", placeholder: "type here…" });
      const frame = stripAnsi(lastFrame() ?? "");
      expect(frame).toContain("type here…");
    });

    it("hidden when value is present", () => {
      const { lastFrame } = renderInput({ value: "hi", placeholder: "type here…" });
      const frame = stripAnsi(lastFrame() ?? "");
      expect(frame).not.toContain("type here…");
      expect(frame).toContain("hi");
    });
  });

  describe("cursor", () => {
    it("showCursor=true shows cursor char", () => {
      const { lastFrame } = renderInput({ value: "x", showCursor: true });
      const frame = lastFrame() ?? "";
      expect(frame).toContain("\u2588");
    });

    it("showCursor=false hides cursor char", () => {
      const { lastFrame } = renderInput({ value: "x", showCursor: false });
      const frame = stripAnsi(lastFrame() ?? "");
      expect(frame).not.toContain("\u2588");
    });
  });

  describe("prompt", () => {
    it("prompt string appears in output", () => {
      const { lastFrame } = renderInput({ value: "", prompt: "/ " });
      const frame = stripAnsi(lastFrame() ?? "");
      expect(frame).toContain("/ ");
    });
  });
});
