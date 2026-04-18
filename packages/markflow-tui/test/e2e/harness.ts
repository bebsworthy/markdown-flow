// test/e2e/harness.ts
//
// Layer-3 node-pty + @xterm/headless harness. Spawns the built TUI binary
// (packages/markflow-tui/dist/cli.js) inside a PTY, feeds bytes through an
// xterm emulator, and exposes a small session API for journey tests.
//
// See docs/tui/plans/P9-T1.md §2.3 + §3.1-§3.6.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pty from "node-pty";
import xtermHeadless from "@xterm/headless";

const { Terminal } = xtermHeadless;

import { canonicalize, keys } from "./ansi.js";
import { createScratchEnv, type ScratchEnv } from "./tmp.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Default ms budgets — one place to tune. See plan §3.6. */
export const DEFAULT_READY_MS = 5_000;
export const DEFAULT_WAIT_MS = 15_000;
export const DEFAULT_RUN_MS = 30_000;

const POLL_INTERVAL_MS = 50;

export interface SpawnOpts {
  readonly cols?: number;
  readonly rows?: number;
  readonly args?: ReadonlyArray<string>;
  readonly scratch?: ScratchEnv;
  readonly binaryPath?: string;
}

export interface TuiSession {
  screen(): string;
  snapshot(): string;
  write(bytes: string): void;
  pressEnter(): void;
  pressEsc(): void;
  pressCtrlC(): void;
  waitFor(
    predicate: (snapshot: string) => boolean | Promise<boolean>,
    timeoutMs?: number,
  ): Promise<void>;
  waitForText(needle: string, timeoutMs?: number): Promise<void>;
  snapshotContains(re: RegExp): boolean;
  waitForRegex(re: RegExp, timeoutMs?: number): Promise<void>;
  /**
   * Wait until the run's event log has at least `minSeq` events.
   * Binds tests to engine state, not visual timing. Returns the full
   * parsed event array on success.
   */
  waitForEventLog(
    runId: string,
    minSeq: number,
    timeoutMs?: number,
  ): Promise<ReadonlyArray<Record<string, unknown>>>;
  waitForExit(timeoutMs?: number): Promise<{ exitCode: number | null }>;
  resize(cols: number, rows: number): void;
  kill(): Promise<void>;
  readonly scratch: ScratchEnv;
  readonly ownsScratch: boolean;
}

export class HarnessTimeoutError extends Error {
  readonly snapshot: string;
  constructor(message: string, snapshot: string) {
    super(`${message}\n\n--- Last snapshot ---\n${snapshot}\n---`);
    this.name = "HarnessTimeoutError";
    this.snapshot = snapshot;
  }
}

/** Resolve the built CLI entrypoint. */
function defaultBinaryPath(): string {
  // this file lives at packages/markflow-tui/test/e2e/harness.ts
  // binary sits at  packages/markflow-tui/dist/cli.js
  return path.resolve(__dirname, "..", "..", "dist", "cli.js");
}

/** Sleep helper (internal to the poll loop — NEVER export or use elsewhere). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Spawn the built TUI binary under node-pty and attach an xterm emulator.
 */
export async function spawnTui(opts: SpawnOpts = {}): Promise<TuiSession> {
  if (process.platform === "win32") {
    throw new Error(
      "markflow-tui e2e harness is unsupported on Windows (ConPTY). " +
        "Use test.skipIf(process.platform === 'win32') in journey files.",
    );
  }

  const cols = opts.cols ?? 120;
  const rows = opts.rows ?? 40;
  const scratch = opts.scratch ?? (await createScratchEnv());
  const ownsScratch = !opts.scratch;
  const binaryPath = opts.binaryPath ?? defaultBinaryPath();

  // Debug: mirror PTY bytes to the test runner's stdout so you can watch the
  // TUI repaint live while the test drives it. Enable with `E2E_DEBUG=1`.
  const debugMirror = process.env.E2E_DEBUG === "1";

  // Debug: dump a canonicalised frame to disk after every waitFor settles.
  // Set `E2E_FRAME_DIR=/abs/path` to enable. Frames are numbered monotonically
  // per-session. Useful for post-mortem — `cat frames/*.txt` or diff adjacent.
  const frameDir = process.env.E2E_FRAME_DIR
    ? path.resolve(process.env.E2E_FRAME_DIR)
    : null;
  let frameCounter = 0;
  if (frameDir) {
    await mkdir(frameDir, { recursive: true });
  }

  const args: string[] = [
    binaryPath,
    "--list",
    scratch.registryPath,
    ...(opts.args ?? []),
  ];

  const term = new Terminal({
    cols,
    rows,
    allowProposedApi: true,
    scrollback: 0,
  });

  const child = pty.spawn("node", args, {
    name: "xterm-256color",
    cols,
    rows,
    cwd: scratch.workspaceDir,
    env: scratch.env as { [key: string]: string },
  });

  let exited = false;
  let exitCode: number | null = null;

  child.onData((chunk) => {
    term.write(chunk);
    if (debugMirror) {
      process.stdout.write(chunk);
    }
  });
  child.onExit(({ exitCode: code }) => {
    exited = true;
    exitCode = code;
  });

  const readScreen = (): string => {
    const buf = term.buffer.active;
    const lines: string[] = [];
    for (let y = 0; y < rows; y += 1) {
      const line = buf.getLine(y);
      lines.push(line ? line.translateToString(true) : "");
    }
    return lines.join("\n");
  };

  const snapshot = (): string => canonicalize(readScreen());

  const dumpFrame = async (snap: string, label: string): Promise<void> => {
    if (!frameDir) return;
    frameCounter += 1;
    const name = `${String(frameCounter).padStart(4, "0")}-${label}.txt`;
    await writeFile(path.join(frameDir, name), snap, "utf8");
  };

  const waitFor = async (
    predicate: (snap: string) => boolean | Promise<boolean>,
    timeoutMs: number = DEFAULT_WAIT_MS,
  ): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const snap = snapshot();
      const result = await predicate(snap);
      if (result) {
        await dumpFrame(snap, "ok");
        return;
      }
      if (exited && exitCode !== 0) {
        await dumpFrame(snap, "exit");
        throw new HarnessTimeoutError(
          `TUI exited with code ${exitCode ?? "null"} before predicate satisfied`,
          snap,
        );
      }
      await sleep(POLL_INTERVAL_MS);
    }
    const finalSnap = snapshot();
    await dumpFrame(finalSnap, "timeout");
    throw new HarnessTimeoutError(
      `waitFor predicate not satisfied within ${timeoutMs}ms`,
      finalSnap,
    );
  };

  const waitForText = (needle: string, timeoutMs?: number): Promise<void> =>
    waitFor((snap) => snap.includes(needle), timeoutMs);

  const snapshotContains = (re: RegExp): boolean => re.test(snapshot());

  const waitForRegex = (re: RegExp, timeoutMs?: number): Promise<void> =>
    waitFor((snap) => re.test(snap), timeoutMs);

  const waitForEventLog = async (
    runId: string,
    minSeq: number,
    timeoutMs: number = DEFAULT_WAIT_MS,
  ): Promise<ReadonlyArray<Record<string, unknown>>> => {
    const eventsPath = path.join(scratch.runsDir, runId, "events.jsonl");
    const deadline = Date.now() + timeoutMs;
    let lastEvents: ReadonlyArray<Record<string, unknown>> = [];
    while (Date.now() < deadline) {
      try {
        const raw = await readFile(eventsPath, "utf8");
        const lines = raw.split("\n").filter((l) => l.length > 0);
        lastEvents = lines.map(
          (l) => JSON.parse(l) as Record<string, unknown>,
        );
        if (lastEvents.length >= minSeq) return lastEvents;
      } catch {
        // file doesn't exist yet — keep polling
      }
      if (exited && exitCode !== 0) {
        throw new HarnessTimeoutError(
          `TUI exited with code ${exitCode ?? "null"} before event log reached seq ${minSeq}`,
          snapshot(),
        );
      }
      await sleep(POLL_INTERVAL_MS);
    }
    throw new HarnessTimeoutError(
      `event log for ${runId} did not reach seq ${minSeq} within ${timeoutMs}ms (saw ${lastEvents.length})`,
      snapshot(),
    );
  };

  const waitForExit = async (
    timeoutMs: number = DEFAULT_WAIT_MS,
  ): Promise<{ exitCode: number | null }> => {
    const deadline = Date.now() + timeoutMs;
    while (!exited && Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
    }
    if (!exited) {
      throw new HarnessTimeoutError(
        `TUI did not exit within ${timeoutMs}ms`,
        snapshot(),
      );
    }
    return { exitCode };
  };

  let killed = false;
  const kill = async (): Promise<void> => {
    if (killed) return;
    killed = true;
    try {
      if (!exited) child.kill();
    } catch {
      /* already dead */
    }
    // Give the process a brief moment to die; don't wait forever.
    const deadline = Date.now() + 2_000;
    while (!exited && Date.now() < deadline) {
      await sleep(20);
    }
    try {
      term.dispose();
    } catch {
      /* ignore */
    }
    if (ownsScratch) {
      await scratch.cleanup();
    }
  };

  const session: TuiSession = {
    screen: readScreen,
    snapshot,
    write: (bytes: string) => {
      child.write(bytes);
    },
    pressEnter: () => {
      child.write(keys.ENTER);
    },
    pressEsc: () => {
      child.write(keys.ESC);
    },
    pressCtrlC: () => {
      child.write(keys.CTRL_C);
    },
    waitFor,
    waitForText,
    snapshotContains,
    waitForRegex,
    waitForEventLog,
    waitForExit,
    resize: (c: number, r: number) => {
      child.resize(c, r);
      term.resize(c, r);
    },
    kill,
    scratch,
    ownsScratch,
  };

  return session;
}
