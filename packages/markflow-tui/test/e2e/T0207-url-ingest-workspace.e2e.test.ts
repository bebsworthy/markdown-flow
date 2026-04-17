// test/e2e/T0207-url-ingest-workspace.e2e.test.ts
//
// T0207 — URL tab on a valid URL materialises a workspace on the local
// scratch env and registers it as `[workspace]`.
// Refs: features.md §3.1 URL flow.

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import {
  DEFAULT_READY_MS,
  DEFAULT_WAIT_MS,
  spawnTui,
  type TuiSession,
} from "./harness.js";
import { createScratchEnv, type ScratchEnv } from "./tmp.js";
import { keys } from "./ansi.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE = path.resolve(__dirname, "fixtures", "hello.md");

const WORKFLOW_BODY = [
  "# Remote Workflow",
  "",
  "# Flow",
  "",
  "```mermaid",
  "flowchart TD",
  "  start --> finish",
  "```",
  "",
  "# Steps",
  "",
  "## start",
  "",
  "```bash",
  "echo hi",
  "```",
  "",
  "## finish",
  "",
  "```bash",
  "echo done",
  "```",
].join("\n");

function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/markdown" });
      res.end(WORKFLOW_BODY);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("bad addr");
      const url = `http://127.0.0.1:${addr.port}/remote.md`;
      resolve({
        url,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

describe.skipIf(process.platform === "win32")(
  "T0207 URL ingest materialises workspace",
  () => {
    let session: TuiSession | undefined;
    let scratch: ScratchEnv | undefined;
    let serverClose: (() => Promise<void>) | undefined;

    afterEach(async () => {
      if (session) {
        await session.kill();
        session = undefined;
      }
      if (scratch) {
        await scratch.cleanup();
        scratch = undefined;
      }
      if (serverClose) {
        await serverClose();
        serverClose = undefined;
      }
    });

    test("valid URL creates workspace and registers it", async () => {
      scratch = await createScratchEnv();
      const server = await startServer();
      serverClose = server.close;

      session = await spawnTui({ scratch, args: [FIXTURE] });
      await session.waitForText("1 entry", DEFAULT_READY_MS);

      // Open add modal, switch to Path or URL tab.
      session.write("a");
      await session.waitForRegex(/Fuzzy find/, DEFAULT_READY_MS);
      session.write(keys.TAB);
      await session.waitForRegex(/\[ Path or URL \]/, DEFAULT_READY_MS);

      // Type the local server URL.
      session.write(server.url);

      // Press Enter to ingest.
      session.write(keys.ENTER);

      // Modal should close and a new workspace entry should appear.
      await session.waitForText("2 entries", DEFAULT_WAIT_MS);

      // Wait for registry to persist.
      await session.waitFor(async () => {
        try {
          const r = await readFile(scratch!.registryPath, "utf8");
          return (JSON.parse(r) as unknown[]).length === 2;
        } catch {
          return false;
        }
      }, DEFAULT_WAIT_MS);

      const raw = await readFile(scratch.registryPath, "utf8");
      const data = JSON.parse(raw) as Array<{ source: string }>;
      expect(data).toHaveLength(2);

      // The workspace entry should point to a directory under the scratch
      // env (the ingestor uses baseDir — which is cwd — to place workspaces).
      const wsEntry = data.find((e) => e.source !== FIXTURE);
      expect(wsEntry).toBeDefined();

      // The workspace should contain flow.md and .markflow.json.
      const wsDir = wsEntry!.source;
      const flowMd = await readFile(path.join(wsDir, "flow.md"), "utf8");
      expect(flowMd).toContain("# Remote Workflow");

      const config = JSON.parse(
        await readFile(path.join(wsDir, ".markflow.json"), "utf8"),
      ) as { origin?: { url?: string } };
      expect(config.origin?.url).toBe(server.url);
    });
  },
);
