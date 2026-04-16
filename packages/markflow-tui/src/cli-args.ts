// src/cli-args.ts
//
// Tiny argv parser for the registry-related flags (`--no-save`, `--list`).
// Pure — argv in, parsed config + rest out. No process access, no fs.
//
// Deliberately hand-rolled (zero new deps) per docs/tui/plans/P4-T1.md §5.
// When more flags arrive, swap in a real parser (yargs / commander) — the
// public return type is the stable seam.

export interface ParsedRegistryArgs {
  readonly config: {
    readonly listPath: string | null;
    readonly persist: boolean;
  };
  readonly rest: ReadonlyArray<string>;
}

export function parseRegistryFlags(
  argv: ReadonlyArray<string>,
): ParsedRegistryArgs {
  let listPath: string | null = null;
  let persist = true;
  const rest: string[] = [];

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === "--no-save") {
      persist = false;
      i += 1;
      continue;
    }
    if (arg === "--list") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--list requires a path argument");
      }
      listPath = value;
      i += 2;
      continue;
    }
    if (arg.startsWith("--list=")) {
      listPath = arg.slice("--list=".length);
      i += 1;
      continue;
    }
    rest.push(arg);
    i += 1;
  }

  // --no-save wins: in-memory only, ignore any --list value for persistence.
  const finalPath = persist ? listPath : null;
  return {
    config: { listPath: finalPath, persist },
    rest,
  };
}
