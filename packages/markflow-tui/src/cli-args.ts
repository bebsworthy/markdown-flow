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

/**
 * Parse a `--key value` / `--key=value` pair. Returns the consumed count
 * (1 or 2) and the extracted value, or null if `arg` doesn't match.
 */
function matchValueFlag(
  arg: string,
  next: string | undefined,
  name: string,
): { readonly value: string; readonly consumed: 1 | 2 } | null {
  if (arg === `--${name}`) {
    if (next === undefined || next.startsWith("--")) {
      throw new Error(`--${name} requires a path argument`);
    }
    return { value: next, consumed: 2 };
  }
  if (arg.startsWith(`--${name}=`)) {
    return { value: arg.slice(name.length + 3), consumed: 1 };
  }
  return null;
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
    const list = matchValueFlag(arg, argv[i + 1], "list");
    if (list) {
      listPath = list.value;
      i += list.consumed;
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
