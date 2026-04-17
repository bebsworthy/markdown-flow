// src/palette/fuzzy.ts
//
// Pure fuzzy matcher for the command palette (P7-T3). ~60 LoC bespoke.
//
// Scoring (higher == better):
//   - Prefix match:        1000 - name.length
//   - Substring match:     500  - index
//   - Scattered match:     250  - indices[last]
// All matches preserve order ("qt" → "quit" works; "tq" does not).
// Empty query returns all `when(ctx)` rows in catalogue order (score 0).

import type { AppContext } from "../components/types.js";
import type { Command, CommandMatch } from "./types.js";

export function matchCommand(
  query: string,
  command: Command,
): CommandMatch | null {
  const q = query.toLowerCase();
  const n = command.name.toLowerCase();

  if (q === "") {
    return { command, matchedIndices: [], score: 0 };
  }

  if (n.startsWith(q)) {
    return {
      command,
      matchedIndices: range(q.length),
      score: 1000,
    };
  }

  const subIdx = n.indexOf(q);
  if (subIdx >= 0) {
    return {
      command,
      matchedIndices: rangeFrom(subIdx, q.length),
      score: 500 - subIdx,
    };
  }

  // Scattered order-preserving match.
  const scattered: number[] = [];
  let j = 0;
  for (let i = 0; i < n.length && j < q.length; i++) {
    if (n[i] === q[j]) {
      scattered.push(i);
      j++;
    }
  }
  if (j !== q.length) return null;
  const lastIdx = scattered[scattered.length - 1] ?? 0;
  return { command, matchedIndices: scattered, score: 250 - lastIdx };
}

export function filterCommands(
  query: string,
  commands: readonly Command[],
  ctx: AppContext,
): readonly CommandMatch[] {
  const matches: CommandMatch[] = [];
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i]!;
    if (!c.when(ctx)) continue;
    const m = matchCommand(query, c);
    if (m !== null) matches.push(m);
  }
  // Stable sort by score descending; ties broken by catalogue order via
  // stable indexOf lookup.
  const indexOf = new Map<Command, number>();
  for (let i = 0; i < commands.length; i++) indexOf.set(commands[i]!, i);
  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (indexOf.get(a.command) ?? 0) - (indexOf.get(b.command) ?? 0);
  });
  return matches;
}

function range(n: number): readonly number[] {
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = i;
  return out;
}

function rangeFrom(start: number, n: number): readonly number[] {
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = start + i;
  return out;
}
