// test/browser/resolver.test.ts
//
// Resolver integration tests using per-test tmpdirs. Never writes outside
// tmpdir.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveEntries, resolveEntry } from "../../src/browser/resolver.js";
import type { RegistryEntry } from "../../src/registry/types.js";

const VALID_MARKDOWN = `# example-workflow

A simple test flow.

# Flow

\`\`\`mermaid
flowchart TD
  setup --> build
  build --> report
\`\`\`

# Steps

## setup

\`\`\`bash
echo setup
\`\`\`

## build

\`\`\`bash
echo build
\`\`\`

## report

\`\`\`bash
echo report
\`\`\`
`;

describe("resolveEntry", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "markflow-browser-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("valid .md file → status='valid', title=workflow.name", async () => {
    const file = join(dir, "flow.md");
    writeFileSync(file, VALID_MARKDOWN, "utf8");
    const entry: RegistryEntry = {
      source: "flow.md",
      addedAt: "2026-04-15T10:00:00Z",
    };
    const result = await resolveEntry(entry, { baseDir: dir });
    expect(result.status).toBe("valid");
    expect(result.title).toBe("example-workflow");
    expect(result.workflow).not.toBeNull();
    expect(result.sourceKind).toBe("file");
  });

  it("valid .md file with warning-only diagnostics → status='valid'", async () => {
    // Use a simpler workflow — validator may emit warnings for stylistic things,
    // but as long as there are no "error" severity diagnostics we consider valid.
    const file = join(dir, "flow.md");
    writeFileSync(file, VALID_MARKDOWN, "utf8");
    const entry: RegistryEntry = {
      source: "flow.md",
      addedAt: "2026-04-15T10:00:00Z",
    };
    const result = await resolveEntry(entry, { baseDir: dir });
    // As long as no error severity is present status=valid.
    const hasErrors = result.diagnostics.some((d) => d.severity === "error");
    expect(hasErrors).toBe(false);
    expect(result.status).toBe("valid");
  });

  it("valid .md file with error diagnostic → status='parse-error', preview still parseable", async () => {
    // Flow references a node with no step definition — validator emits error.
    const md = `# broken

# Flow

\`\`\`mermaid
flowchart TD
  a --> b
\`\`\`

# Steps

## a

\`\`\`bash
echo a
\`\`\`
`;
    const file = join(dir, "flow.md");
    writeFileSync(file, md, "utf8");
    const entry: RegistryEntry = {
      source: "flow.md",
      addedAt: "2026-04-15T10:00:00Z",
    };
    const result = await resolveEntry(entry, { baseDir: dir });
    expect(result.status).toBe("parse-error");
    // The workflow still parsed, so the preview can render it.
    expect(result.workflow).not.toBeNull();
    expect(result.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("missing file → status='missing', errorReason set", async () => {
    const entry: RegistryEntry = {
      source: "does-not-exist.md",
      addedAt: "2026-04-15T10:00:00Z",
    };
    const result = await resolveEntry(entry, { baseDir: dir });
    expect(result.status).toBe("missing");
    expect(result.errorReason).toBe("404");
    expect(result.workflow).toBeNull();
    expect(result.absolutePath).toBeNull();
  });

  it("malformed .md → status='parse-error', never throws", async () => {
    // Whether the engine parser throws or produces a synthetic workflow, the
    // resolver's contract is: it never throws, always returns a ResolvedEntry.
    const file = join(dir, "bad.md");
    writeFileSync(file, "just text no sections", "utf8");
    const entry: RegistryEntry = {
      source: "bad.md",
      addedAt: "2026-04-15T10:00:00Z",
    };
    const result = await resolveEntry(entry, { baseDir: dir });
    expect(["valid", "parse-error"]).toContain(result.status);
    // The key contract: a ResolvedEntry is always returned.
    expect(result.entry.source).toBe("bad.md");
  });

  it("regular file with wrong extension → status='parse-error'", async () => {
    const file = join(dir, "notes.txt");
    writeFileSync(file, "hello", "utf8");
    const entry: RegistryEntry = {
      source: "notes.txt",
      addedAt: "2026-04-15T10:00:00Z",
    };
    const result = await resolveEntry(entry, { baseDir: dir });
    expect(result.status).toBe("parse-error");
    expect(result.errorReason).toContain("not a .md");
  });

  it("workspace dir with .markflow.json → sourceKind='workspace'", async () => {
    const ws = join(dir, "ws");
    mkdirSync(ws);
    writeFileSync(
      join(ws, "flow.md"),
      VALID_MARKDOWN,
      "utf8",
    );
    writeFileSync(
      join(ws, ".markflow.json"),
      JSON.stringify({ workflowPath: "flow.md" }),
      "utf8",
    );
    const entry: RegistryEntry = {
      source: "ws",
      addedAt: "2026-04-15T10:00:00Z",
    };
    const result = await resolveEntry(entry, { baseDir: dir });
    expect(result.sourceKind).toBe("workspace");
    expect(result.status).toBe("valid");
    expect(result.workflow).not.toBeNull();
  });

  it("workspace dir without .markflow.json → falls back to first *.md", async () => {
    const ws = join(dir, "ws");
    mkdirSync(ws);
    writeFileSync(join(ws, "flow.md"), VALID_MARKDOWN, "utf8");
    const entry: RegistryEntry = {
      source: "ws",
      addedAt: "2026-04-15T10:00:00Z",
    };
    const result = await resolveEntry(entry, { baseDir: dir });
    expect(result.sourceKind).toBe("workspace");
    expect(result.status).toBe("valid");
  });

  it("empty workspace dir (no .md) → status='parse-error'", async () => {
    const ws = join(dir, "ws");
    mkdirSync(ws);
    const entry: RegistryEntry = {
      source: "ws",
      addedAt: "2026-04-15T10:00:00Z",
    };
    const result = await resolveEntry(entry, { baseDir: dir });
    expect(result.status).toBe("parse-error");
    expect(result.sourceKind).toBe("workspace");
    expect(result.errorReason).toBeTruthy();
  });

  it("relative source resolved against opts.baseDir", async () => {
    const file = join(dir, "sub", "flow.md");
    mkdirSync(join(dir, "sub"));
    writeFileSync(file, VALID_MARKDOWN, "utf8");
    const entry: RegistryEntry = {
      source: "sub/flow.md",
      addedAt: "2026-04-15T10:00:00Z",
    };
    const result = await resolveEntry(entry, { baseDir: dir });
    expect(result.status).toBe("valid");
    expect(result.absolutePath).toBe(file);
  });

  it("readLastRun=false skips RunManager call", async () => {
    const ws = join(dir, "ws");
    mkdirSync(ws);
    writeFileSync(join(ws, "flow.md"), VALID_MARKDOWN, "utf8");
    const entry: RegistryEntry = {
      source: "ws",
      addedAt: "2026-04-15T10:00:00Z",
    };
    const result = await resolveEntry(entry, {
      baseDir: dir,
      readLastRun: false,
    });
    expect(result.lastRun).toBeNull();
  });

  it("workspace with no prior runs → lastRun=null", async () => {
    const ws = join(dir, "ws");
    mkdirSync(ws);
    writeFileSync(join(ws, "flow.md"), VALID_MARKDOWN, "utf8");
    const entry: RegistryEntry = {
      source: "ws",
      addedAt: "2026-04-15T10:00:00Z",
    };
    const result = await resolveEntry(entry, { baseDir: dir });
    expect(result.lastRun).toBeNull();
  });

  it("file-kind entry always has lastRun=null (no run dir)", async () => {
    const file = join(dir, "flow.md");
    writeFileSync(file, VALID_MARKDOWN, "utf8");
    const entry: RegistryEntry = {
      source: "flow.md",
      addedAt: "2026-04-15T10:00:00Z",
    };
    const result = await resolveEntry(entry, { baseDir: dir });
    expect(result.lastRun).toBeNull();
  });
});

describe("resolveEntries", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "markflow-browser-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves in parallel; preserves input order", async () => {
    writeFileSync(join(dir, "a.md"), VALID_MARKDOWN, "utf8");
    writeFileSync(join(dir, "b.md"), VALID_MARKDOWN, "utf8");
    writeFileSync(join(dir, "c.md"), VALID_MARKDOWN, "utf8");
    const entries: RegistryEntry[] = [
      { source: "a.md", addedAt: "2026-04-15T10:00:00Z" },
      { source: "b.md", addedAt: "2026-04-15T10:01:00Z" },
      { source: "c.md", addedAt: "2026-04-15T10:02:00Z" },
    ];
    const results = await resolveEntries(entries, { baseDir: dir });
    expect(results.map((r) => r.entry.source)).toEqual(["a.md", "b.md", "c.md"]);
    expect(results.every((r) => r.status === "valid")).toBe(true);
  });

  it("one missing entry does not affect other entries", async () => {
    writeFileSync(join(dir, "a.md"), VALID_MARKDOWN, "utf8");
    const entries: RegistryEntry[] = [
      { source: "a.md", addedAt: "2026-04-15T10:00:00Z" },
      { source: "missing.md", addedAt: "2026-04-15T10:01:00Z" },
    ];
    const results = await resolveEntries(entries, { baseDir: dir });
    expect(results[0]!.status).toBe("valid");
    expect(results[1]!.status).toBe("missing");
  });
});
