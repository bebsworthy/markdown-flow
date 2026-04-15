import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  materializeRemoteTarget,
  readMarkflowJson,
} from "../../src/cli/workspace.js";

const FIXTURE = `# Hello Flow

A tiny fixture.

# Flow

\`\`\`mermaid
flowchart TD
  A[greet]
\`\`\`

# Steps

## greet

\`\`\`bash
echo hello
\`\`\`
`;

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "mf-materialize-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe("materializeRemoteTarget", () => {
  it("returns null for a local file path", async () => {
    const out = await materializeRemoteTarget("./flow.md", undefined);
    expect(out).toBeNull();
  });

  it("fetches an http URL and persists flow.md + .markflow.json", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(FIXTURE, { status: 200, headers: { "content-type": "text/markdown" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const workspaceDir = join(tmp, "ws");
    const result = await materializeRemoteTarget(
      "https://example.com/greet.md",
      workspaceDir,
    );

    expect(result).not.toBeNull();
    expect(result!.workflowPath).toBe(join(workspaceDir, "flow.md"));
    expect(result!.workspaceDir).toBe(workspaceDir);
    expect(result!.origin).toEqual({
      type: "url",
      url: "https://example.com/greet.md",
      fetchedAt: expect.any(String),
    });

    const body = await readFile(result!.workflowPath, "utf-8");
    expect(body).toBe(FIXTURE);

    const meta = await readMarkflowJson(workspaceDir);
    expect(meta?.workflow).toBe("flow.md");
    expect(meta?.origin?.type).toBe("url");
    if (meta?.origin?.type === "url") expect(meta.origin.url).toBe("https://example.com/greet.md");

    expect(fetchMock).toHaveBeenCalledWith("https://example.com/greet.md");
  });

  it("derives workspace from URL basename when --workspace is not set", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(FIXTURE, { status: 200 })),
    );
    const cwd = process.cwd();
    process.chdir(tmp);
    try {
      const result = await materializeRemoteTarget(
        "https://example.com/mything.md",
        undefined,
      );
      expect(result).not.toBeNull();
      expect(result!.workspaceDir.endsWith("/mything")).toBe(true);
    } finally {
      process.chdir(cwd);
    }
  });

  it("throws on non-2xx HTTP response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404, statusText: "Not Found" })),
    );
    await expect(
      materializeRemoteTarget("https://example.com/missing.md", join(tmp, "ws")),
    ).rejects.toThrow(/404/);
  });

  it("throws when stdin is used without --workspace", async () => {
    await expect(materializeRemoteTarget("-", undefined)).rejects.toThrow(
      /requires --workspace/,
    );
  });

  it("preserves origin across a subsequent materialization with a different timestamp", async () => {
    const workspaceDir = join(tmp, "ws");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(FIXTURE, { status: 200 })),
    );
    const first = await materializeRemoteTarget("https://example.com/a.md", workspaceDir);
    expect(first).not.toBeNull();
    // Re-materialize — origin should still be URL-typed and fetchedAt should advance or be equal.
    const second = await materializeRemoteTarget("https://example.com/a.md", workspaceDir);
    const meta = await readMarkflowJson(workspaceDir);
    expect(meta?.origin?.type).toBe("url");
    expect(second?.origin.type).toBe("url");
  });

  it("reads stdin when target is '-' and --workspace is provided", async () => {
    const fakeStdin = Readable.from([FIXTURE]);
    const orig = Object.getOwnPropertyDescriptor(process, "stdin");
    Object.defineProperty(process, "stdin", {
      value: fakeStdin,
      configurable: true,
    });
    try {
      const workspaceDir = join(tmp, "ws-stdin");
      const result = await materializeRemoteTarget("-", workspaceDir);
      expect(result).not.toBeNull();
      expect(result!.origin.type).toBe("stdin");
      const body = await readFile(result!.workflowPath, "utf-8");
      expect(body).toBe(FIXTURE);
      const meta = await readMarkflowJson(workspaceDir);
      expect(meta?.origin?.type).toBe("stdin");
    } finally {
      if (orig) Object.defineProperty(process, "stdin", orig);
    }
  });
});
