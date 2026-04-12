import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/core/template.js";

const ns = (namespaces: Record<string, unknown>) => ({ vars: {}, namespaces });

describe("json filter", () => {
  it("stringifies with 2-space indent", () => {
    expect(
      renderTemplate("{{ o | json }}", ns({ o: { a: 1 } }), "s"),
    ).toBe('{\n  "a": 1\n}');
  });

  it("accepts a comma-separated field filter", () => {
    const out = renderTemplate(
      '{{ o | json: "name,age" }}',
      ns({ o: { name: "Ada", age: 36, secret: "x" } }),
      "s",
    );
    expect(JSON.parse(out)).toEqual({ name: "Ada", age: 36 });
  });

  it("applies field filter to arrays of objects", () => {
    const out = renderTemplate(
      '{{ xs | json: "name" }}',
      ns({ xs: [{ name: "a", extra: 1 }, { name: "b", extra: 2 }] }),
      "s",
    );
    expect(JSON.parse(out)).toEqual([{ name: "a" }, { name: "b" }]);
  });
});

describe("yaml filter", () => {
  it("dumps as yaml", () => {
    const out = renderTemplate(
      "{{ o | yaml }}",
      ns({ o: { a: 1, b: "two" } }),
      "s",
    );
    expect(out).toBe("a: 1\nb: two");
  });

  it("accepts a field filter", () => {
    const out = renderTemplate(
      '{{ o | yaml: "name" }}',
      ns({ o: { name: "Ada", secret: "x" } }),
      "s",
    );
    expect(out).toBe("name: Ada");
  });
});

describe("list filter", () => {
  it("renders an array of primitives as a bullet list", () => {
    const out = renderTemplate(
      "{{ xs | list }}",
      ns({ xs: ["a", "b", "c"] }),
      "s",
    );
    expect(out).toBe("- a\n- b\n- c");
  });

  it("renders `name: description` for object arrays", () => {
    const out = renderTemplate(
      '{{ xs | list: "name,description" }}',
      ns({
        xs: [
          { name: "bug", description: "a defect" },
          { name: "feat", description: "new work" },
        ],
      }),
      "s",
    );
    expect(out).toBe("- `bug`: a defect\n- `feat`: new work");
  });

  it("throws on non-array input", () => {
    expect(() =>
      renderTemplate("{{ x | list }}", ns({ x: "nope" }), "s"),
    ).toThrow(/list filter expects an array/);
  });
});

describe("table filter", () => {
  it("renders a markdown table", () => {
    const out = renderTemplate(
      '{{ xs | table: "name,age" }}',
      ns({
        xs: [
          { name: "Ada", age: 36 },
          { name: "Bob", age: 42 },
        ],
      }),
      "s",
    );
    expect(out).toBe(
      "| name | age |\n| --- | --- |\n| Ada | 36 |\n| Bob | 42 |",
    );
  });

  it("JSON-stringifies nested object cells", () => {
    const out = renderTemplate(
      '{{ xs | table: "name,meta" }}',
      ns({ xs: [{ name: "a", meta: { k: 1 } }] }),
      "s",
    );
    expect(out).toContain('| a | {"k":1} |');
  });

  it("escapes pipe characters in cells", () => {
    const out = renderTemplate(
      '{{ xs | table: "label" }}',
      ns({ xs: [{ label: "a|b" }] }),
      "s",
    );
    expect(out).toContain("| a\\|b |");
  });

  it("errors without field names", () => {
    expect(() =>
      renderTemplate("{{ xs | table }}", ns({ xs: [{ a: 1 }] }), "s"),
    ).toThrow(/at least one field/);
  });
});

describe("code filter", () => {
  it("wraps in an empty fence by default", () => {
    const out = renderTemplate("{{ s | code }}", { s: "hi" }, "s");
    expect(out).toBe("```\nhi\n```");
  });

  it("accepts a language", () => {
    const out = renderTemplate('{{ s | code: "json" }}', { s: "{}" }, "s");
    expect(out).toBe("```json\n{}\n```");
  });

  it("composes with json", () => {
    const out = renderTemplate(
      '{{ o | json | code: "json" }}',
      ns({ o: { a: 1 } }),
      "s",
    );
    expect(out).toBe('```json\n{\n  "a": 1\n}\n```');
  });
});

describe("heading / quote / indent", () => {
  it("heading prefixes N hashes", () => {
    expect(
      renderTemplate('{{ t | heading: 2 }}', { t: "Title" }, "s"),
    ).toBe("## Title");
  });

  it("heading clamps level to 1..6", () => {
    expect(renderTemplate('{{ t | heading: 99 }}', { t: "X" }, "s")).toBe(
      "###### X",
    );
  });

  it("quote prefixes every line", () => {
    expect(renderTemplate('{{ t | quote }}', { t: "a\nb" }, "s")).toBe(
      "> a\n> b",
    );
  });

  it("indent pads every line", () => {
    expect(
      renderTemplate('{{ t | indent: 4 }}', { t: "a\nb" }, "s"),
    ).toBe("    a\n    b");
  });
});

describe("pluck / keys / values", () => {
  it("pluck extracts a field", () => {
    const out = renderTemplate(
      '{{ xs | pluck: "name" | join: ", " }}',
      ns({ xs: [{ name: "a" }, { name: "b" }] }),
      "s",
    );
    expect(out).toBe("a, b");
  });

  it("keys returns object keys", () => {
    const out = renderTemplate(
      '{{ o | keys | join: "," }}',
      ns({ o: { a: 1, b: 2 } }),
      "s",
    );
    expect(out).toBe("a,b");
  });

  it("values returns object values", () => {
    const out = renderTemplate(
      '{{ o | values | join: "," }}',
      ns({ o: { a: 1, b: 2 } }),
      "s",
    );
    expect(out).toBe("1,2");
  });
});
