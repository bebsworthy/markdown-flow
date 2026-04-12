import { describe, it, expect } from "vitest";
import { hasTemplateVars, renderTemplate } from "../../src/core/template.js";

describe("hasTemplateVars", () => {
  it("returns false for plain text", () => {
    expect(hasTemplateVars("no variables here")).toBe(false);
  });

  it("returns true when ${VAR} is present", () => {
    expect(hasTemplateVars("hello ${NAME}")).toBe(true);
  });

  it("returns true for escaped $${VAR} (still counts as template syntax)", () => {
    expect(hasTemplateVars("literal $${VAR}")).toBe(true);
  });

  it("ignores lowercase ${var}", () => {
    expect(hasTemplateVars("hello ${name}")).toBe(false);
  });
});

describe("renderTemplate", () => {
  it("substitutes a single variable", () => {
    expect(renderTemplate("hello ${NAME}", { NAME: "world" }, "s1")).toBe(
      "hello world",
    );
  });

  it("substitutes multiple variables", () => {
    const result = renderTemplate(
      "Review ${REPO} for ${CRITERIA}",
      { REPO: "my-app", CRITERIA: "security" },
      "s1",
    );
    expect(result).toBe("Review my-app for security");
  });

  it("substitutes the same variable multiple times", () => {
    expect(
      renderTemplate("${X} and ${X}", { X: "ok" }, "s1"),
    ).toBe("ok and ok");
  });

  it("handles variables with underscores and numbers", () => {
    expect(
      renderTemplate("${MY_VAR_2}", { MY_VAR_2: "val" }, "s1"),
    ).toBe("val");
  });

  it("substitutes to empty string for empty values", () => {
    expect(renderTemplate("a${X}b", { X: "" }, "s1")).toBe("ab");
  });

  it("throws on undefined variable with helpful message", () => {
    expect(() => renderTemplate("${MISSING}", { OTHER: "x" }, "review")).toThrow(
      'Template variable "${MISSING}" in step "review" is not defined. Available: OTHER',
    );
  });

  it("escapes $${VAR} to literal ${VAR}", () => {
    expect(renderTemplate("use $${VAR} syntax", {}, "s1")).toBe(
      "use ${VAR} syntax",
    );
  });

  it("does not recurse into substituted values", () => {
    expect(
      renderTemplate("${A}", { A: "${B}", B: "nope" }, "s1"),
    ).toBe("${B}");
  });

  it("leaves text unchanged when no template vars present", () => {
    expect(renderTemplate("plain text", {}, "s1")).toBe("plain text");
  });
});
