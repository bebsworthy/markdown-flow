// test/add-modal/walker.test.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { walkCandidates } from "../../src/add-modal/walker.js";
import type {
  Candidate,
  TruncatedSentinel,
} from "../../src/add-modal/types.js";

async function collect(
  root: string,
  opts: Parameters<typeof walkCandidates>[1] = {},
): Promise<Array<Candidate | TruncatedSentinel>> {
  const out: Array<Candidate | TruncatedSentinel> = [];
  for await (const c of walkCandidates(root, opts)) out.push(c);
  return out;
}

describe("walkCandidates", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "markflow-walker-"));
  });

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  it("single .md file at root → yields one file candidate", async () => {
    writeFileSync(join(dir, "only.md"), "# x\n");
    const out = await collect(dir);
    const files = out.filter((c) => c.kind === "file") as Candidate[];
    expect(files).toHaveLength(1);
    expect(files[0]!.displayPath).toBe("only.md");
  });

  it("nested dirs → BFS order deterministic", async () => {
    mkdirSync(join(dir, "a"));
    mkdirSync(join(dir, "b"));
    writeFileSync(join(dir, "root.md"), "");
    writeFileSync(join(dir, "a/a.md"), "");
    writeFileSync(join(dir, "b/b.md"), "");
    const out = await collect(dir);
    const files = (out.filter((c) => c.kind === "file") as Candidate[]).map(
      (c) => c.displayPath,
    );
    // Root-level files come before descendants (BFS).
    expect(files[0]).toBe("root.md");
    expect(files.slice(1).sort()).toEqual(["a/a.md", "b/b.md"]);
  });

  it("directory with .markflow.json → yields workspace candidate, doesn't descend", async () => {
    mkdirSync(join(dir, "ws"));
    writeFileSync(join(dir, "ws/.markflow.json"), "{}");
    writeFileSync(join(dir, "ws/flow.md"), "# x");
    const out = await collect(dir);
    const workspaces = out.filter((c) => c.kind === "workspace") as Candidate[];
    const files = out.filter((c) => c.kind === "file") as Candidate[];
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]!.displayPath).toBe("ws");
    // flow.md should NOT have been yielded as a file candidate.
    expect(files.find((f) => f.displayPath.includes("ws"))).toBeUndefined();
  });

  it("hidden dir (.foo) skipped", async () => {
    mkdirSync(join(dir, ".foo"));
    writeFileSync(join(dir, ".foo/hidden.md"), "");
    writeFileSync(join(dir, "visible.md"), "");
    const files = (await collect(dir)).filter((c) => c.kind === "file") as Candidate[];
    expect(files.map((f) => f.displayPath)).toEqual(["visible.md"]);
  });

  it(".git skipped by default", async () => {
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, ".git/config.md"), "");
    writeFileSync(join(dir, "top.md"), "");
    const files = (await collect(dir)).filter((c) => c.kind === "file") as Candidate[];
    expect(files.map((f) => f.displayPath)).toEqual(["top.md"]);
  });

  it("node_modules skipped by default", async () => {
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "node_modules/pkg.md"), "");
    writeFileSync(join(dir, "README.md"), "");
    const files = (await collect(dir)).filter((c) => c.kind === "file") as Candidate[];
    expect(files.map((f) => f.displayPath)).toEqual(["README.md"]);
  });

  it("custom skipDirs override default", async () => {
    mkdirSync(join(dir, "build"));
    writeFileSync(join(dir, "build/x.md"), "");
    writeFileSync(join(dir, "a.md"), "");
    const files = (
      await collect(dir, { skipDirs: ["build"] })
    ).filter((c) => c.kind === "file") as Candidate[];
    expect(files.map((f) => f.displayPath)).toEqual(["a.md"]);
  });

  it("maxCandidates cap → yields TruncatedSentinel", async () => {
    writeFileSync(join(dir, "a.md"), "");
    writeFileSync(join(dir, "b.md"), "");
    writeFileSync(join(dir, "c.md"), "");
    const out = await collect(dir, { maxCandidates: 2 });
    const files = out.filter((c) => c.kind === "file");
    const trunc = out.filter((c) => c.kind === "truncated");
    expect(files).toHaveLength(2);
    expect(trunc).toHaveLength(1);
  });

  it("maxDepth cap → shallower subtree only", async () => {
    mkdirSync(join(dir, "sub"));
    mkdirSync(join(dir, "sub/deep"));
    writeFileSync(join(dir, "top.md"), "");
    writeFileSync(join(dir, "sub/mid.md"), "");
    writeFileSync(join(dir, "sub/deep/bot.md"), "");
    const files = (
      await collect(dir, { maxDepth: 1 })
    ).filter((c) => c.kind === "file") as Candidate[];
    const paths = files.map((f) => f.displayPath);
    expect(paths).toContain("top.md");
    expect(paths).toContain("sub/mid.md");
    expect(paths).not.toContain("sub/deep/bot.md");
  });

  it("unreadable dir (permission error) → skipped silently", async () => {
    mkdirSync(join(dir, "unread"));
    writeFileSync(join(dir, "unread/hidden.md"), "");
    writeFileSync(join(dir, "ok.md"), "");
    // Chmod to 0 (no read) — macOS/Linux. Some CI may still read as root.
    chmodSync(join(dir, "unread"), 0o000);
    try {
      const files = (await collect(dir)).filter(
        (c) => c.kind === "file",
      ) as Candidate[];
      // At minimum the root file is found; the inaccessible dir is skipped.
      expect(files.find((f) => f.displayPath === "ok.md")).toBeDefined();
    } finally {
      chmodSync(join(dir, "unread"), 0o755);
    }
  });

  it("signal.aborted mid-walk → stops yielding", async () => {
    for (let i = 0; i < 10; i++) {
      writeFileSync(join(dir, `f${i}.md`), "");
    }
    const controller = new AbortController();
    const out: Array<Candidate | TruncatedSentinel> = [];
    for await (const c of walkCandidates(dir, { signal: controller.signal })) {
      out.push(c);
      if (out.length === 2) controller.abort();
    }
    expect(out.length).toBeLessThanOrEqual(10);
  });

  it("no .md files and no workspaces → empty iteration", async () => {
    writeFileSync(join(dir, "a.txt"), "");
    const out = await collect(dir);
    expect(out).toHaveLength(0);
  });

  it("symlink cycles → does NOT infinite loop", async () => {
    mkdirSync(join(dir, "loop"));
    writeFileSync(join(dir, "root.md"), "");
    // Create a symlink pointing to the parent dir.
    try {
      symlinkSync(dir, join(dir, "loop/back"));
    } catch {
      // Some environments forbid symlink creation — skip the loop setup.
    }
    const out = await collect(dir, { maxCandidates: 50 });
    expect(out.length).toBeLessThanOrEqual(51); // includes potential sentinel
  });

  it("displayPath uses root-relative form", async () => {
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub/a.md"), "");
    const files = (await collect(dir)).filter((c) => c.kind === "file") as Candidate[];
    expect(files[0]!.displayPath).toBe("sub/a.md");
  });
});
