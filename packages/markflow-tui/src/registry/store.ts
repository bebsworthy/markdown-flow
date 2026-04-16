// src/registry/store.ts
//
// Public async API for the workflow registry (P4-T1). Facade over the
// pure helpers in ./helpers.ts and the atomic-write primitive in
// ./atomic-write.ts.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { writeFileAtomic } from "./atomic-write.js";
import {
  parseRegistryJson,
  serializeRegistry,
} from "./helpers.js";
import type { LoadResult, RegistryError, RegistryState } from "./types.js";

const DEFAULT_FILENAME = ".markflow-tui.json";

/**
 * Resolve the registry path. When `override === null`, returns
 * `path.resolve(cwd, ".markflow-tui.json")`. When `override` is absolute
 * it wins outright; when relative it's resolved against `cwd`.
 */
export function resolveRegistryPath(
  override: string | null,
  cwd: string,
): string {
  if (override === null) {
    return path.resolve(cwd, DEFAULT_FILENAME);
  }
  return path.resolve(cwd, override);
}

function isNodeError(e: unknown): e is NodeJS.ErrnoException {
  return typeof e === "object" && e !== null && "code" in e;
}

/**
 * Load the registry from disk.
 *
 *   - File missing            → `{ entries: [] }`, no backup.
 *   - File valid              → parsed entries.
 *   - File present + malformed or wrong-shape:
 *       1. Write raw bytes to `<registryPath>.bak` via writeFileAtomic.
 *       2. Return empty state with `corruptionDetected: true`.
 *       3. Do NOT delete the original; the next `saveRegistry` replaces it.
 *   - Any other I/O error    → rethrow as `RegistryError { kind: "io" }`.
 */
export async function loadRegistry(registryPath: string): Promise<LoadResult> {
  let raw: string;
  try {
    raw = await fs.readFile(registryPath, "utf8");
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return {
        state: { entries: [] },
        corruptionDetected: false,
        backupPath: null,
      };
    }
    const typed: RegistryError = { kind: "io", cause: err, path: registryPath };
    throw typed;
  }

  const parsed = parseRegistryJson(raw);
  if (parsed !== null) {
    return {
      state: parsed,
      corruptionDetected: false,
      backupPath: null,
    };
  }

  // Corrupt — write backup alongside the original. Don't touch the original.
  const backupPath = `${registryPath}.bak`;
  await writeFileAtomic(backupPath, raw);
  return {
    state: { entries: [] },
    corruptionDetected: true,
    backupPath,
  };
}

/**
 * Save the registry atomically. Never mutates input; never retries.
 */
export async function saveRegistry(
  registryPath: string,
  state: RegistryState,
): Promise<void> {
  const contents = serializeRegistry(state);
  await writeFileAtomic(registryPath, contents);
}
