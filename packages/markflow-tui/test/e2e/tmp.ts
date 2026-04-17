// test/e2e/tmp.ts
//
// Per-test scratch environment for the Layer-3 PTY harness. Creates an
// isolated temp directory with sub-dirs for HOME, registry, runs, and the
// workspace cwd, and returns a deterministic env map to pass into
// `node-pty.spawn`.
//
// See docs/tui/plans/P9-T1.md §2.2 + §3.1 (env pins are overrides, not extends).

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface RegistryEntrySeed {
  readonly source: string;
  readonly addedAt?: string;
}

export interface ScratchEnv {
  readonly dir: string;
  readonly env: NodeJS.ProcessEnv;
  readonly registryPath: string;
  readonly workspaceDir: string;
  readonly runsDir: string;
  readonly cleanup: () => Promise<void>;
  /**
   * Pre-populate the registry file before `spawnTui` reads it. Missing
   * `addedAt` fields default to `2026-01-01T00:00:00Z`. Writes atomically
   * via `writeFile`; the TUI's own `--list` points at the same path.
   */
  readonly writeRegistry: (
    entries: ReadonlyArray<RegistryEntrySeed>,
  ) => Promise<void>;
}

/**
 * Create a per-test scratch environment with deterministic env pins.
 * See docs/tui/plans/P9-T1.md §2.2.
 */
export async function createScratchEnv(): Promise<ScratchEnv> {
  const root = path.join(tmpdir(), `markflow-tui-e2e-${randomUUID()}`);
  const homeDir = path.join(root, "home");
  const registryDir = path.join(root, "registry");
  const runsDir = path.join(root, "runs");
  const workspaceDir = path.join(root, "workspace");

  await mkdir(homeDir, { recursive: true });
  await mkdir(registryDir, { recursive: true });
  await mkdir(runsDir, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });

  const registryPath = path.join(registryDir, "registry.json");

  // PATH is the only host env key we forward — node-pty needs it to locate
  // `node`. Everything else is pinned to eliminate host flakes.
  const pathEnv = process.env.PATH ?? "/usr/bin:/bin:/usr/local/bin";

  const env: NodeJS.ProcessEnv = {
    PATH: pathEnv,
    HOME: homeDir,
    TERM: "xterm-256color",
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    MARKFLOW_ASCII: "1",
    MARKFLOW_TEST: "1",
    TZ: "UTC",
    MARKFLOW_RUNS_DIR: runsDir,
    MARKFLOW_WORKSPACE_DIR: workspaceDir,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
  };

  const writeRegistry = async (
    entries: ReadonlyArray<RegistryEntrySeed>,
  ): Promise<void> => {
    const payload = {
      entries: entries.map((e) => ({
        source: e.source,
        addedAt: e.addedAt ?? "2026-01-01T00:00:00Z",
      })),
    };
    await writeFile(registryPath, JSON.stringify(payload, null, 2), "utf8");
  };

  return {
    dir: root,
    env,
    registryPath,
    workspaceDir,
    runsDir,
    writeRegistry,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}
