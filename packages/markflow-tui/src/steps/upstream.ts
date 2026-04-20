// src/steps/upstream.ts
//
// "upstream failed" predicate + NOTE label for skipped step rows. The TUI
// does not see the Mermaid `FlowGraph`, so we use `Token.parentTokenId` as
// the authoritative upstream edge — mockup §6 renders `deploy-ap · skipped`
// with NOTE `"upstream failed"` and its parent token is the failed `fan-out`.
//
// Authoritative references:
//   - docs/tui/plans/P6-T1.md §7
//   - docs/tui/mockups.md §6
//
// PURITY NOTE: no ink/react/node:* imports.

import type { Token } from "markflow-cli";

// ---------------------------------------------------------------------------
// Predicate
// ---------------------------------------------------------------------------

/**
 * Return `true` when `token` was skipped because one of its upstream tokens
 * failed. For MVP the upstream proxy is the parent token (the engine marks
 * fan-out children with `parentTokenId` pointing at the fan-out token).
 * Returns false for non-skipped tokens, tokens without a parent, and
 * skipped tokens whose parent is not in a failure state.
 */
export function isUpstreamFailed(
  token: Token,
  tokensById: ReadonlyMap<string, Token>,
): boolean {
  if (token.state !== "skipped") return false;
  if (!token.parentTokenId) return false;
  const parent = tokensById.get(token.parentTokenId);
  if (!parent) return false;
  return parentFailed(parent);
}

function parentFailed(parent: Token): boolean {
  if (parent.state !== "complete") return false;
  if (!parent.result) return false;
  return parent.result.edge.startsWith("fail");
}

// ---------------------------------------------------------------------------
// Label
// ---------------------------------------------------------------------------

/**
 * Return the NOTE-column label when `isUpstreamFailed(token, tokensById)`
 * is true, otherwise `null`. Text matches mockup §6 verbatim:
 *   "upstream failed" — no colon (plan §7.3 decision).
 */
export function upstreamNoteLabel(
  token: Token,
  tokensById: ReadonlyMap<string, Token>,
): string | null {
  if (!isUpstreamFailed(token, tokensById)) return null;
  return "upstream failed";
}
