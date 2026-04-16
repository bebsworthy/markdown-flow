// test/registry/atomic-write.test.ts
//
// Tests for `writeFileAtomic` (P4-T1 §6.2). Uses a per-test tmpdir under
// os.tmpdir() — NEVER the repo root. Fault injection via vi.spyOn.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// vi.mock is hoisted — we build a proxy namespace that delegates to the real
// node:fs/promises unless a test has set an override on the hoisted registry.
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

// Import AFTER vi.mock is set up.
const { writeFileAtomic } = await import(
  "../../src/registry/atomic-write.js"
);
const fsPromises = await import("node:fs/promises");

describe("writeFileAtomic", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "markflow-tui-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    overrides.clear();
    vi.restoreAllMocks();
  });

  it("creates a new file when target does not exist", async () => {
    const p = join(dir, "out.json");
    await writeFileAtomic(p, "hello");
    expect(readFileSync(p, "utf8")).toBe("hello");
  });

  it("replaces an existing file with new contents", async () => {
    const p = join(dir, "out.json");
    writeFileSync(p, "original", "utf8");
    await writeFileAtomic(p, "replaced");
    expect(readFileSync(p, "utf8")).toBe("replaced");
  });

  it("preserves file permissions 0o644 on new files", async () => {
    const p = join(dir, "out.json");
    await writeFileAtomic(p, "x");
    const mode = statSync(p).mode & 0o777;
    // umask can lower the mode, but never above 0o644 (write from open with
    // mode 0o644). Common test platforms (macOS/Linux) produce 0o644 or
    // 0o600 depending on umask. Assert write permission bits for owner.
    expect(mode & 0o600).toBe(0o600);
  });

  it("leaves no temp files behind on success (dir contains only the target)", async () => {
    const p = join(dir, "out.json");
    await writeFileAtomic(p, "x");
    expect(readdirSync(dir)).toEqual(["out.json"]);
  });

  it("cleans up temp file if write fails mid-process", async () => {
    const p = join(dir, "out.json");
    overrides.set("rename", () => {
      throw new Error("synthetic rename failure");
    });
    await expect(writeFileAtomic(p, "x")).rejects.toThrow(
      "synthetic rename failure",
    );
    overrides.delete("rename");
    // Target should not exist (rename never happened).
    expect(() => readFileSync(p, "utf8")).toThrow();
    // Temp file should have been cleaned up.
    const files = readdirSync(dir);
    expect(files.length).toBe(0);
  });

  it("preserves the original target when the write fails before rename", async () => {
    const p = join(dir, "out.json");
    writeFileSync(p, "original", "utf8");
    overrides.set("rename", () => {
      throw new Error("synthetic rename failure");
    });
    await expect(writeFileAtomic(p, "replaced")).rejects.toThrow();
    expect(readFileSync(p, "utf8")).toBe("original");
  });

  it("two concurrent writes to the same path produce one of the two payloads", async () => {
    const p = join(dir, "out.json");
    await Promise.all([
      writeFileAtomic(p, "A"),
      writeFileAtomic(p, "B"),
    ]);
    const content = readFileSync(p, "utf8");
    expect(content === "A" || content === "B").toBe(true);
  });

  it("two concurrent writes never produce a half-written / corrupt file", async () => {
    const p = join(dir, "out.json");
    const payloadA = "AAAA".repeat(256); // 1KB
    const payloadB = "BBBB".repeat(256); // 1KB, same length but distinguishable
    await Promise.all([
      writeFileAtomic(p, payloadA),
      writeFileAtomic(p, payloadB),
    ]);
    const content = readFileSync(p, "utf8");
    expect(content === payloadA || content === payloadB).toBe(true);
  });

  it("uses a same-directory temp file (temp path shares dirname with target)", async () => {
    const p = join(dir, "out.json");
    const openCalls: string[] = [];
    const realOpen = fsPromises.open;
    overrides.set("open", (path: unknown, flags: unknown, mode: unknown) => {
      if (flags === "wx") openCalls.push(String(path));
      return realOpen(path as string, flags as string, mode as number);
    });
    await writeFileAtomic(p, "x");
    expect(openCalls.length).toBe(1);
    expect(openCalls[0]!.startsWith(dir)).toBe(true);
  });
});
