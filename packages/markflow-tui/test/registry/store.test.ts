// test/registry/store.test.ts
//
// End-to-end tests for `loadRegistry` / `saveRegistry` / `resolveRegistryPath`.
// Uses per-test tmpdirs — NEVER the repo root.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// vi.mock is hoisted. We use a Proxy that forwards to the real
// node:fs/promises unless an override is set by a specific test.
const overrides = vi.hoisted(
  () => new Map<string, (...args: unknown[]) => unknown>(),
);

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>(
    "node:fs/promises",
  );
  return new Proxy(actual, {
    get(target, prop: string) {
      const override = overrides.get(prop);
      if (override !== undefined) return override;
      return (target as Record<string, unknown>)[prop];
    },
  });
});

const {
  loadRegistry,
  saveRegistry,
  resolveRegistryPath,
} = await import("../../src/registry/store.js");
const { addEntry, removeEntry } = await import(
  "../../src/registry/helpers.js"
);
type RegistryState = {
  readonly entries: ReadonlyArray<{ source: string; addedAt: string }>;
};

describe("resolveRegistryPath", () => {
  it("override=null resolves to <cwd>/.markflow-tui.json", () => {
    expect(resolveRegistryPath(null, "/a/b")).toBe("/a/b/.markflow-tui.json");
  });

  it("override='relative.json' resolves against cwd", () => {
    expect(resolveRegistryPath("relative.json", "/a/b")).toBe(
      "/a/b/relative.json",
    );
  });

  it("override='/abs/p.json' wins outright (absolute)", () => {
    expect(resolveRegistryPath("/abs/p.json", "/a/b")).toBe("/abs/p.json");
  });
});

describe("loadRegistry / saveRegistry", () => {
  let dir: string;
  let p: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "markflow-tui-"));
    p = join(dir, ".markflow-tui.json");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    overrides.clear();
    vi.restoreAllMocks();
  });

  it("file-not-found: returns empty state, corruptionDetected=false, backupPath=null", async () => {
    const out = await loadRegistry(p);
    expect(out.state.entries).toEqual([]);
    expect(out.corruptionDetected).toBe(false);
    expect(out.backupPath).toBeNull();
  });

  it("valid file: returns parsed entries in on-disk order", async () => {
    writeFileSync(
      p,
      JSON.stringify(
        [
          { source: "./a.md", addedAt: "2026-04-15T10:00:00Z" },
          { source: "./b.md", addedAt: "2026-04-15T11:00:00Z" },
        ],
        null,
        2,
      ),
      "utf8",
    );
    const out = await loadRegistry(p);
    expect(out.state.entries.map((e) => e.source)).toEqual(["./a.md", "./b.md"]);
    expect(out.corruptionDetected).toBe(false);
  });

  it("malformed JSON: returns empty, corruptionDetected=true, .bak written with original bytes", async () => {
    const original = "{not json";
    writeFileSync(p, original, "utf8");
    const out = await loadRegistry(p);
    expect(out.state.entries).toEqual([]);
    expect(out.corruptionDetected).toBe(true);
    expect(out.backupPath).toBe(`${p}.bak`);
    expect(readFileSync(out.backupPath!, "utf8")).toBe(original);
  });

  it("wrong-shape JSON (top-level object): returns empty, corruptionDetected=true, .bak written", async () => {
    writeFileSync(p, '{"not": "an array"}', "utf8");
    const out = await loadRegistry(p);
    expect(out.corruptionDetected).toBe(true);
    expect(existsSync(out.backupPath!)).toBe(true);
  });

  it("wrong-shape JSON (entry missing addedAt): corruptionDetected=true, .bak written", async () => {
    writeFileSync(p, '[{"source": "./a.md"}]', "utf8");
    const out = await loadRegistry(p);
    expect(out.corruptionDetected).toBe(true);
    expect(existsSync(out.backupPath!)).toBe(true);
  });

  it("malformed file is NOT deleted by load (original stays on disk alongside .bak)", async () => {
    writeFileSync(p, "{not json", "utf8");
    await loadRegistry(p);
    expect(existsSync(p)).toBe(true);
    expect(existsSync(`${p}.bak`)).toBe(true);
  });

  it("EACCES on read: rethrows as RegistryError { kind: 'io' }", async () => {
    // Force a non-ENOENT I/O error — inject via the hoisted override.
    overrides.set("readFile", () => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    });
    await expect(loadRegistry(p)).rejects.toMatchObject({
      kind: "io",
      path: p,
    });
  });

  it("empty file (0 bytes): treated as malformed, .bak written, empty state returned", async () => {
    writeFileSync(p, "", "utf8");
    const out = await loadRegistry(p);
    expect(out.corruptionDetected).toBe(true);
    expect(out.state.entries).toEqual([]);
  });

  it("existing .bak is overwritten by a new corruption (no .bak.bak chain)", async () => {
    const bak = `${p}.bak`;
    writeFileSync(bak, "old-backup", "utf8");
    writeFileSync(p, "{still corrupt", "utf8");
    await loadRegistry(p);
    expect(readFileSync(bak, "utf8")).toBe("{still corrupt");
    // No .bak.bak created.
    expect(readdirSync(dir).filter((f) => f.endsWith(".bak.bak"))).toEqual([]);
  });
});

describe("saveRegistry", () => {
  let dir: string;
  let p: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "markflow-tui-"));
    p = join(dir, ".markflow-tui.json");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    overrides.clear();
    vi.restoreAllMocks();
  });

  it("writes valid JSON parseable back by loadRegistry (round-trip)", async () => {
    const state: RegistryState = {
      entries: [
        { source: "./a.md", addedAt: "2026-04-15T10:00:00Z" },
        { source: "./b.md", addedAt: "2026-04-15T11:00:00Z" },
      ],
    };
    await saveRegistry(p, state);
    const out = await loadRegistry(p);
    expect(out.state).toEqual(state);
  });

  it("uses 2-space indentation", async () => {
    const state: RegistryState = {
      entries: [{ source: "./a.md", addedAt: "2026-04-15T10:00:00Z" }],
    };
    await saveRegistry(p, state);
    const raw = readFileSync(p, "utf8");
    expect(raw).toContain('  "source": "./a.md"');
  });

  it("ends with a trailing newline", async () => {
    await saveRegistry(p, { entries: [] });
    expect(readFileSync(p, "utf8").endsWith("\n")).toBe(true);
  });

  it("is atomic: crashing fs.rename leaves the original file intact", async () => {
    writeFileSync(p, "original", "utf8");
    overrides.set("rename", () => {
      throw new Error("boom");
    });
    await expect(
      saveRegistry(p, { entries: [] }),
    ).rejects.toThrow("boom");
    expect(readFileSync(p, "utf8")).toBe("original");
  });

  it("does not leak temp files on success", async () => {
    await saveRegistry(p, { entries: [] });
    const files = readdirSync(dir);
    expect(files).toEqual([".markflow-tui.json"]);
  });

  it("overwrites a previous save with new entries", async () => {
    await saveRegistry(p, {
      entries: [{ source: "./a.md", addedAt: "2026-04-15T10:00:00Z" }],
    });
    await saveRegistry(p, {
      entries: [{ source: "./b.md", addedAt: "2026-04-15T11:00:00Z" }],
    });
    const out = await loadRegistry(p);
    expect(out.state.entries.map((e) => e.source)).toEqual(["./b.md"]);
  });
});

describe("round-trip acceptance criterion", () => {
  let dir: string;
  let p: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "markflow-tui-"));
    p = join(dir, ".markflow-tui.json");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("add → save → load preserves entries byte-for-byte", async () => {
    const { state } = await loadRegistry(p);
    const next = addEntry(state, {
      source: "./a.md",
      addedAt: "2026-04-15T10:00:00Z",
    });
    await saveRegistry(p, next);
    const { state: loaded } = await loadRegistry(p);
    expect(loaded).toEqual(next);
  });

  it("remove → save → load preserves the new list", async () => {
    const state: RegistryState = {
      entries: [
        { source: "./a.md", addedAt: "2026-04-15T10:00:00Z" },
        { source: "./b.md", addedAt: "2026-04-15T11:00:00Z" },
      ],
    };
    await saveRegistry(p, state);
    const { state: loaded } = await loadRegistry(p);
    const next = removeEntry(loaded, (e) => e.source === "./a.md");
    await saveRegistry(p, next);
    const { state: final } = await loadRegistry(p);
    expect(final.entries.map((e) => e.source)).toEqual(["./b.md"]);
  });

  it("add-then-remove-same-source leaves an empty on-disk file", async () => {
    const added = addEntry(
      { entries: [] },
      { source: "./a.md", addedAt: "2026-04-15T10:00:00Z" },
    );
    await saveRegistry(p, added);
    const removed = removeEntry(added, () => true);
    await saveRegistry(p, removed);
    const { state } = await loadRegistry(p);
    expect(state.entries).toEqual([]);
  });
});

describe("concurrent saveRegistry", () => {
  let dir: string;
  let p: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "markflow-tui-"));
    p = join(dir, ".markflow-tui.json");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("two saveRegistry calls race: final file is exactly one of the two payloads", async () => {
    const stateA: RegistryState = {
      entries: [{ source: "./a.md", addedAt: "2026-04-15T10:00:00Z" }],
    };
    const stateB: RegistryState = {
      entries: [{ source: "./b.md", addedAt: "2026-04-15T11:00:00Z" }],
    };
    await Promise.all([saveRegistry(p, stateA), saveRegistry(p, stateB)]);
    const out = await loadRegistry(p);
    const source = out.state.entries[0]!.source;
    expect(source === "./a.md" || source === "./b.md").toBe(true);
    expect(out.corruptionDetected).toBe(false);
  });

  it("neither writer corrupts the file", async () => {
    const stateA: RegistryState = {
      entries: [{ source: "./a.md", addedAt: "2026-04-15T10:00:00Z" }],
    };
    const stateB: RegistryState = {
      entries: [{ source: "./b.md", addedAt: "2026-04-15T11:00:00Z" }],
    };
    await Promise.all([saveRegistry(p, stateA), saveRegistry(p, stateB)]);
    // Round-trip parse — load itself validates the shape.
    const out = await loadRegistry(p);
    expect(out.corruptionDetected).toBe(false);
    expect(out.state.entries.length).toBe(1);
  });
});
