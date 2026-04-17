// test/runStart/derive.test.ts
//
// Unit tests for the pure `runStart/derive.ts` helpers (P9-T1).

import { describe, it, expect } from "vitest";
import type { WorkflowDefinition } from "markflow";
import {
  canSubmitRunInputs,
  composeRunInputs,
  deriveRunInputRows,
  missingRequiredInputs,
} from "../../src/runStart/derive.js";
import type { RunInputRow } from "../../src/runStart/types.js";

function wf(inputs: WorkflowDefinition["inputs"]): WorkflowDefinition {
  return {
    name: "wf",
    description: "",
    inputs,
    graph: { nodes: new Map(), edges: [] },
    steps: new Map(),
    sourceFile: "/fake.md",
  };
}

function row(partial: Partial<RunInputRow> & Pick<RunInputRow, "key">): RunInputRow {
  return {
    key: partial.key,
    description: partial.description ?? "",
    required: partial.required ?? false,
    placeholder: partial.placeholder ?? "",
    draft: partial.draft ?? "",
  };
}

describe("deriveRunInputRows", () => {
  it("preserves declaration order + maps required/default/description", () => {
    const rows = deriveRunInputRows(
      wf([
        { name: "env", required: true, description: "target env", default: "prod" },
        { name: "version", required: false, description: "sha" },
      ]),
    );
    expect(rows.map((r) => r.key)).toEqual(["env", "version"]);
    expect(rows[0]).toEqual({
      key: "env",
      description: "target env",
      required: true,
      placeholder: "prod",
      draft: "",
    });
    expect(rows[1]).toEqual({
      key: "version",
      description: "sha",
      required: false,
      placeholder: "",
      draft: "",
    });
  });

  it("empty inputs[] yields empty rows", () => {
    expect(deriveRunInputRows(wf([]))).toEqual([]);
  });
});

describe("missingRequiredInputs", () => {
  it("required + empty draft + empty placeholder → included", () => {
    expect(
      missingRequiredInputs([
        row({ key: "a", required: true }),
        row({ key: "b", required: true, placeholder: "p" }),
      ]),
    ).toEqual(["a"]);
  });

  it("required with placeholder → excluded", () => {
    expect(
      missingRequiredInputs([
        row({ key: "a", required: true, placeholder: "p" }),
      ]),
    ).toEqual([]);
  });

  it("optional rows → always excluded", () => {
    expect(
      missingRequiredInputs([
        row({ key: "a", required: false }),
        row({ key: "b", required: false, placeholder: "" }),
      ]),
    ).toEqual([]);
  });

  it("draft preferred over placeholder", () => {
    expect(
      missingRequiredInputs([
        row({ key: "a", required: true, draft: "x" }),
      ]),
    ).toEqual([]);
  });
});

describe("composeRunInputs", () => {
  it("skips optional rows whose draft is empty", () => {
    expect(
      composeRunInputs([
        row({ key: "a", required: false }),
        row({ key: "b", required: false, draft: "v" }),
      ]),
    ).toEqual({ b: "v" });
  });

  it("emits required rows as draft || placeholder", () => {
    expect(
      composeRunInputs([
        row({ key: "a", required: true, placeholder: "p" }),
        row({ key: "b", required: true, draft: "d", placeholder: "p" }),
      ]),
    ).toEqual({ a: "p", b: "d" });
  });
});

describe("canSubmitRunInputs", () => {
  it("true iff missingRequiredInputs is empty", () => {
    expect(
      canSubmitRunInputs([row({ key: "a", required: true, placeholder: "p" })]),
    ).toBe(true);
    expect(canSubmitRunInputs([row({ key: "a", required: true })])).toBe(false);
  });
});
