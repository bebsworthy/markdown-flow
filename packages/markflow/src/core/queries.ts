import type { EngineSnapshot, Token } from "./types.js";

export function tokensByBatch(
  snapshot: EngineSnapshot,
  batchId: string,
): Token[] {
  const out: Token[] = [];
  for (const token of snapshot.tokens.values()) {
    if (token.batchId === batchId) out.push(token);
  }
  return out;
}
