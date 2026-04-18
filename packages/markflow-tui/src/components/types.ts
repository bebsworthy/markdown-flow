// src/components/types.ts
//
// Types for the keybar primitive (P3-T4). Authoritative references:
//   - docs/tui/features.md §5.6 (Keybar rules, lines 406–493)
//   - docs/tui/mockups.md §15   (Mode / width matrix)
//   - docs/tui/plans/P3-T4.md   (this-task plan)
//
// PURITY NOTE: this module MUST NOT import from `react`, `ink`, `node:*`,
// or any other I/O / rendering surface. It declares types and a couple of
// pure interfaces only. Registered in test/state/purity.test.ts.
//
// Rule 9 ("single keymap array"): the `action` field on `Binding` is
// stored here but never invoked by <Keybar>. The first invoker is the
// `useInput` wiring task (P4-T1). Same binding array feeds both the
// renderer and the handler.

import type { AppState } from "../state/types.js";

/**
 * A key descriptor. Matches the spec examples verbatim (features.md
 * line 456):
 *   ["f"]                         — single letter
 *   ["Ctrl", "r"]                 — modifier + letter (last element is the key)
 *   ["Left","Down","Up","Right"]  — grouped directional family
 *
 * The array is interpreted by `formatKeys()` in keybar-layout.ts. We do
 * NOT constrain the element type beyond `string` — a union type would be
 * nicer but over-tightening before the `useInput` wiring (P4-T1) risks
 * churn. `formatKeys` treats unknown tokens as literal text.
 */
export type KeySpec = ReadonlyArray<string>;

/**
 * Category label — free-form per features.md §5.6 examples (`RUN`, `VIEW`,
 * `LOGS`). Kept as `string`; tightening to a closed union would require
 * updating every feature task that introduces a new category. Convention:
 * uppercase ASCII, <=6 chars.
 */
export type Category = string;

/**
 * Read-only view the keybar passes to every `when(ctx)` and (later) every
 * `action(ctx)`. Deliberately NOT a full `AppState` — the keybar's purity
 * boundary is narrower: it should be swappable with a different source of
 * mode/overlay info without touching the component.
 *
 * Fields are additive. Any new predicate that needs a new field must add
 * it here, not reach into `AppState` ad-hoc.
 */
export interface AppContext {
  /** Mirrors `AppState.mode` verbatim. See state/types.ts. */
  readonly mode: AppState["mode"];
  /** Mirrors `AppState.overlay`. `null` means "no modal". */
  readonly overlay: AppState["overlay"];
  /**
   * True while a run has an approval waiting. Derived upstream by the
   * engine adapter (P3-T2).
   */
  readonly approvalsPending: boolean;
  /** True while the log panel is in tail-follow mode. */
  readonly isFollowing: boolean;
  /** True while the log panel wraps long lines. */
  readonly isWrapped: boolean;
  /** True while the Events pane is following the live tail (P6-T4).
   *  Optional — callers outside `viewing.events` need not supply it. */
  readonly eventsIsFollowing?: boolean;
  /**
   * Count of pending approvals relevant to the current view (P7-T1).
   * Used by the `a Approve (N)` binding's `when(ctx)` predicate
   * (hide-don't-grey) and its `toggleLabel`. Defaults to 0 when omitted.
   */
  readonly pendingApprovalsCount?: number;
  /**
   * True when the active run (in `viewing.*`) is resumable — status is
   * `"error"` or `"suspended"`. Set by `<App>` from `effectiveEngineState`
   * when `mode.kind === "viewing"` and the active run matches. Used by the
   * `R Re-run` binding's `when(ctx)` predicate (hide-don't-grey). Defaults
   * to `false` when omitted.
   */
  readonly runResumable?: boolean;
  /** True while the currently-focused run is live (status === "running").
   *  Used by `:cancel` command availability (P7-T3). */
  readonly runActive?: boolean;
  /** `runsDir` is ready (adapter bootstrapped). Used by `:resume` when no
   *  arg (P7-T3). */
  readonly runsDirReady?: boolean;
  /**
   * Count of suspended (approval-waiting) runs visible in the runs table.
   * Used by the `r Resume (N)` binding's `when(ctx)` predicate
   * (hide-don't-grey) and its `toggleLabel`. Defaults to 0 when omitted.
   */
  readonly suspendedRunsCount?: number;
  /**
   * Generic payload threaded to `toggleLabel`. For the log `f` binding
   * this is `isFollowing`; for the `w` binding it is `isWrapped`. The
   * binding author picks which field to narrow, so the type is `unknown`.
   */
  readonly toggleState: Readonly<Record<string, unknown>>;
}

/**
 * Keybar binding — matches features.md §5.6 lines 452–465 data model.
 *
 * `toggleLabel` signature uses `unknown` per the spec; each binding that
 * uses it is responsible for narrowing its own toggle state.
 *
 * `action` is declared but NEVER called by <Keybar>. This is the single-
 * keymap-array contract (rule 9). The first invoker is P4-T1.
 */
export interface Binding {
  readonly keys: KeySpec;
  readonly label: string;
  readonly shortLabel?: string;
  readonly toggleLabel?: (state: unknown) => string;
  readonly category?: Category;
  readonly destructive?: boolean;
  readonly when: (ctx: AppContext) => boolean;
  readonly action: (ctx: AppContext) => void | Promise<void>;
  /**
   * Optional per-tier extra-whitespace knob. The renderer adds this many
   * spaces (in addition to the base 2-or-1-space inter-binding separator)
   * AFTER this binding when the next binding in the same group renders.
   * Used to encode mockups.md §15 sub-grouping inside a single category
   * (e.g. RUNS wide: "a Approve   s Status" — 3sp instead of 2sp). A
   * single number is shorthand for { full, short, keys } all equal.
   */
  readonly gapAfter?:
    | number
    | { readonly full?: number; readonly short?: number; readonly keys?: number };
  /**
   * Optional override for the literal separator that prefixes this binding
   * in the keys (<60) tier. Defaults to a single space. Used by RUN-graph
   * narrow which renders pipe separators per mockups.md §15.
   */
  readonly narrowSeparator?: string;
  /**
   * Tiers on which this binding must be hidden. Default: `[]` (always
   * visible). Used by fixtures to encode mockups.md §15 narrow-tier drops
   * (e.g. WORKFLOWS `q` hidden on keys; APPROVAL `?` hidden on keys).
   */
  readonly hideOnTier?: ReadonlyArray<"full" | "short" | "keys">;
  /**
   * Tiers on which the `label` is suppressed (keys-only rendering). Used
   * by VIEW toggles and some globals in mockups.md §15 where the wide
   * tier still shows keys-only for the binding even though the binding
   * carries a label (needed so rule-coverage tests in keybar.test.tsx
   * can look up `q Quit` but the matrix row can still elide it).
   */
  readonly hideLabelOn?: ReadonlyArray<"full" | "short" | "keys">;
  /**
   * Optional override for the whitespace separator placed BEFORE this
   * binding in the specified tier. Takes precedence over the base + prev's
   * `gapAfter`. Used for the RUNS `? q` wide-tier case where two keys-
   * only globals sit 1sp apart in defiance of the 2sp full-tier default.
   */
  readonly sepBefore?: {
    readonly full?: number;
    readonly short?: number;
    readonly keys?: number;
  };
}
