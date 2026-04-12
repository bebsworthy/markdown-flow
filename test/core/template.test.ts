import { describe, it, expect } from "vitest";
import { hasTemplateVars, renderTemplate } from "../../src/core/template.js";

describe("hasTemplateVars", () => {
  it("returns false for plain text", () => {
    expect(hasTemplateVars("no variables here")).toBe(false);
  });

  it("returns true when {{ VAR }} is present", () => {
    expect(hasTemplateVars("hello {{ NAME }}")).toBe(true);
  });

  it("returns true when a Liquid tag is present", () => {
    expect(hasTemplateVars("{% for x in items %}{{ x }}{% endfor %}")).toBe(true);
  });

  it("ignores shell-style ${VAR}", () => {
    expect(hasTemplateVars("hello ${NAME}")).toBe(false);
  });
});

describe("renderTemplate", () => {
  it("substitutes a single variable", () => {
    expect(renderTemplate("hello {{ NAME }}", { NAME: "world" }, "s1")).toBe(
      "hello world",
    );
  });

  it("substitutes multiple variables", () => {
    const result = renderTemplate(
      "Review {{ REPO }} for {{ CRITERIA }}",
      { REPO: "my-app", CRITERIA: "security" },
      "s1",
    );
    expect(result).toBe("Review my-app for security");
  });

  it("resolves dotted-path references via namespaces", () => {
    const result = renderTemplate(
      "Title: {{ GLOBAL.item.title }}",
      { vars: {}, namespaces: { GLOBAL: { item: { title: "My ticket" } } } },
      "s1",
    );
    expect(result).toBe("Title: My ticket");
  });

  it("iterates over arrays with {% for %}", () => {
    const result = renderTemplate(
      "{% for l in GLOBAL.labels %}- {{ l.name }}\n{% endfor %}",
      {
        vars: {},
        namespaces: {
          GLOBAL: {
            labels: [{ name: "Bug" }, { name: "Feature" }, { name: "Docs" }],
          },
        },
      },
      "s1",
    );
    expect(result).toBe("- Bug\n- Feature\n- Docs\n");
  });

  it("supports the `default` filter", () => {
    const result = renderTemplate(
      "Body: {{ GLOBAL.item.body | default: '(empty)' }}",
      { vars: {}, namespaces: { GLOBAL: { item: { body: "" } } } },
      "s1",
    );
    expect(result).toBe("Body: (empty)");
  });

  it("throws on undefined variable with step-scoped message", () => {
    expect(() =>
      renderTemplate("{{ MISSING }}", { OTHER: "x" }, "review"),
    ).toThrow(/Template error in step "review"/);
  });

  it("throws on undefined dotted path", () => {
    expect(() =>
      renderTemplate(
        "{{ STEPS.ghost.state.x }}",
        { vars: {}, namespaces: { STEPS: {} } },
        "review",
      ),
    ).toThrow(/Template error in step "review"/);
  });

  it("{% raw %} preserves literal Liquid-looking text", () => {
    expect(
      renderTemplate("use {% raw %}{{ VAR }}{% endraw %} syntax", {}, "s1"),
    ).toBe("use {{ VAR }} syntax");
  });

  it("leaves text unchanged when no template vars present", () => {
    expect(renderTemplate("plain text", {}, "s1")).toBe("plain text");
  });
});
