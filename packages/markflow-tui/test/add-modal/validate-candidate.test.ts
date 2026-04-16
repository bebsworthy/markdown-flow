// test/add-modal/validate-candidate.test.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateCandidate } from "../../src/add-modal/validate-candidate.js";
import type { Candidate } from "../../src/add-modal/types.js";

const MINIMAL_WORKFLOW = `# Hello

A greeting.

# Flow

\`\`\`mermaid
flowchart TD
  start --> done
\`\`\`

# Steps

## start

\`\`\`bash
echo hi
\`\`\`

## done

\`\`\`bash
echo bye
\`\`\`
`;

function mkFileCandidate(absolutePath: string): Candidate {
  return {
    kind: "file",
    absolutePath,
    displayPath: absolutePath,
    depth: 0,
  };
}

function mkWorkspaceCandidate(absolutePath: string): Candidate {
  return {
    kind: "workspace",
    absolutePath,
    displayPath: absolutePath,
    depth: 1,
  };
}

describe("validateCandidate — file", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "markflow-validate-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("valid .md → {kind: 'file-valid'}", async () => {
    const p = join(dir, "flow.md");
    writeFileSync(p, MINIMAL_WORKFLOW);
    const res = await validateCandidate(mkFileCandidate(p));
    expect(res.kind).toBe("file-valid");
  });

  it("missing file → {kind: 'file-parse-error'}", async () => {
    const res = await validateCandidate(mkFileCandidate(join(dir, "nope.md")));
    expect(res.kind).toBe("file-parse-error");
  });

  it("malformed .md (no Flow section) → {kind: 'file-parse-error'}", async () => {
    const p = join(dir, "bad.md");
    writeFileSync(p, "# Just a title\n\nSome text but no flow section.\n");
    const res = await validateCandidate(mkFileCandidate(p));
    expect(res.kind).toBe("file-parse-error");
  });

  it(".md with validator errors → still file-valid (parse succeeded)", async () => {
    const p = join(dir, "ok.md");
    // Parseable but may fail deep validation (we still expect parse to succeed).
    writeFileSync(p, MINIMAL_WORKFLOW);
    const res = await validateCandidate(mkFileCandidate(p));
    expect(res.kind).toBe("file-valid");
  });
});

describe("validateCandidate — workspace", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "markflow-validate-ws-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("workspace with .markflow.json + valid flow.md → {kind: 'workspace'}", async () => {
    writeFileSync(join(dir, "flow.md"), MINIMAL_WORKFLOW);
    writeFileSync(
      join(dir, ".markflow.json"),
      JSON.stringify({ workflow: "flow.md" }),
    );
    const res = await validateCandidate(mkWorkspaceCandidate(dir));
    expect(res.kind).toBe("workspace");
  });

  it("workspace with .markflow.json but missing `workflow` key → workspace-invalid", async () => {
    writeFileSync(join(dir, "flow.md"), MINIMAL_WORKFLOW);
    writeFileSync(join(dir, ".markflow.json"), JSON.stringify({}));
    const res = await validateCandidate(mkWorkspaceCandidate(dir));
    expect(res.kind).toBe("workspace-invalid");
  });

  it("workspace without .markflow.json, single .md → workspace (fallback)", async () => {
    writeFileSync(join(dir, "flow.md"), MINIMAL_WORKFLOW);
    const res = await validateCandidate(mkWorkspaceCandidate(dir));
    expect(res.kind).toBe("workspace");
  });

  it("workspace with no .md at all → workspace-invalid", async () => {
    mkdirSync(join(dir, "nested"));
    const res = await validateCandidate(mkWorkspaceCandidate(dir));
    expect(res.kind).toBe("workspace-invalid");
  });

  it("workspace with .markflow.json pointing at missing file → workspace-invalid", async () => {
    writeFileSync(
      join(dir, ".markflow.json"),
      JSON.stringify({ workflow: "missing.md" }),
    );
    const res = await validateCandidate(mkWorkspaceCandidate(dir));
    expect(res.kind).toBe("workspace-invalid");
  });

  it("never throws — all errors become ValidationResult", async () => {
    const res = await validateCandidate(
      mkWorkspaceCandidate("/definitely/does/not/exist/ever"),
    );
    expect(res.kind).toBe("workspace-invalid");
  });
});
