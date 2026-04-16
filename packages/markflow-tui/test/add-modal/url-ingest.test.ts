// test/add-modal/url-ingest.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingestUrl, urlSlug } from "../../src/add-modal/url-ingest.js";

function mockFetchResponse(
  body: string,
  { status = 200, contentType = "text/markdown" }: {
    status?: number;
    contentType?: string;
  } = {},
): Response {
  const resp = new Response(body, {
    status,
    headers: { "content-type": contentType },
  });
  return resp;
}

describe("ingestUrl", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "markflow-ingest-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("invalid prefix (missing http://) → {ok: false, reason: /expected http/}", async () => {
    const res = await ingestUrl("ftp://foo/bar.md", dir);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/expected http/);
  });

  it("200 OK → writes flow.md with body; .markflow.json with origin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockFetchResponse("# hello\n")),
    );
    const url = "https://example.com/flows/hello.md";
    const res = await ingestUrl(url, dir);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(existsSync(res.workflowPath)).toBe(true);
    expect(readFileSync(res.workflowPath, "utf8")).toBe("# hello\n");
    const config = JSON.parse(
      readFileSync(join(res.workspaceDir, ".markflow.json"), "utf8"),
    );
    expect(config.workflow).toBe("flow.md");
    expect(config.origin.type).toBe("url");
    expect(config.origin.url).toBe(url);
    expect(typeof config.origin.fetchedAt).toBe("string");
  });

  it("200 OK with text/markdown content-type works", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockFetchResponse("# md", { contentType: "text/markdown" }),
      ),
    );
    const res = await ingestUrl("https://example.com/x.md", dir);
    expect(res.ok).toBe(true);
  });

  it("200 OK with non-markdown content-type still writes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockFetchResponse("# md", { contentType: "text/plain" }),
      ),
    );
    const res = await ingestUrl("https://example.com/x.md", dir);
    expect(res.ok).toBe(true);
  });

  it("404 → {ok: false, reason: /HTTP 404/}", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockFetchResponse("not found", { status: 404 })),
    );
    const res = await ingestUrl("https://example.com/missing.md", dir);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/HTTP 404/);
  });

  it("network error (fetch throws) → {ok: false, reason}", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const res = await ingestUrl("https://example.com/x.md", dir);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/network error/);
  });

  it("slug derivation: /foo/bar.md → workspace dir 'bar'", () => {
    expect(urlSlug("https://example.com/foo/bar.md")).toBe("bar");
  });

  it("slug collision: second URL with same slug → 'bar-2'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockFetchResponse("# one")),
    );
    const first = await ingestUrl("https://a.example.com/bar.md", dir);
    expect(first.ok).toBe(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockFetchResponse("# two")),
    );
    const second = await ingestUrl("https://b.example.com/bar.md", dir);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.workspaceDir).not.toBe(second.workspaceDir);
    expect(second.workspaceDir).toMatch(/bar-2$/);
  });

  it("re-fetch same URL → overwrites flow.md + bumps fetchedAt", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockFetchResponse("v1")));
    const first = await ingestUrl("https://example.com/x.md", dir);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const firstConfig = JSON.parse(
      readFileSync(join(first.workspaceDir, ".markflow.json"), "utf8"),
    );

    // Ensure a clock tick passes so fetchedAt differs
    await new Promise((r) => setTimeout(r, 5));

    vi.stubGlobal("fetch", vi.fn(async () => mockFetchResponse("v2")));
    const second = await ingestUrl("https://example.com/x.md", dir);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.workspaceDir).toBe(first.workspaceDir);
    expect(readFileSync(second.workflowPath, "utf8")).toBe("v2");
    const secondConfig = JSON.parse(
      readFileSync(join(second.workspaceDir, ".markflow.json"), "utf8"),
    );
    expect(secondConfig.origin.fetchedAt).not.toBe(firstConfig.origin.fetchedAt);
  });

  it("unsafe chars in slug → sanitised to [-a-zA-Z0-9_.]", () => {
    expect(urlSlug("https://example.com/foo bar!.md")).toMatch(/^[-A-Za-z0-9_.]+$/);
  });
});
