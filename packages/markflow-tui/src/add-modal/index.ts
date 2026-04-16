// src/add-modal/index.ts
//
// Public barrel for the add-modal module (P4-T3). Re-exports the pure
// scorer, the walker, the validator, the URL ingestor, and the type
// surface. Does NOT re-export React components — those live in
// `src/components/add-*.tsx`.

export { rankCandidates, scoreSubsequence } from "./fuzzy.js";
export { walkCandidates } from "./walker.js";
export { validateCandidate } from "./validate-candidate.js";
export { ingestUrl, urlSlug } from "./url-ingest.js";
export type {
  AddModalTab,
  Candidate,
  CandidateKind,
  RankedCandidate,
  TruncatedSentinel,
  UrlIngestResult,
  ValidationResult,
  WalkerOptions,
} from "./types.js";
