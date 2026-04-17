// src/help/derive.ts
//
// Pure derivation: filter `Binding[]` via `when(ctx)` (hide-don't-grey),
// resolve toggleLabel, group by category, apply optional search. (P7-T3)

import type { AppContext, Binding } from "../components/types.js";
import type { HelpModel, HelpRow, HelpSection } from "./types.js";
import { formatKeys } from "../components/keybar-layout.js";

export interface DeriveHelpArgs {
  readonly bindings: readonly Binding[];
  readonly ctx: AppContext;
  readonly search: string; // lowercased; empty = no filter
}

export function deriveHelpModel(args: DeriveHelpArgs): HelpModel {
  const { bindings, ctx, search } = args;
  const q = search.toLowerCase();

  const filtered = bindings.filter((b) => b.when(ctx));

  // Group by category preserving the fixture's original order.
  const sectionMap = new Map<string, HelpRow[]>();
  const orderedCats: string[] = [];

  for (const b of filtered) {
    const label =
      b.toggleLabel !== undefined
        ? b.toggleLabel(resolveToggleTarget(b, ctx))
        : b.label;
    const annotation = annotateBinding(b, ctx);
    const keysText = formatKeys(b.keys).toLowerCase();
    if (q.length > 0) {
      const hay = `${label.toLowerCase()} ${keysText}`;
      if (!hay.includes(q)) continue;
    }
    const cat = b.category ?? "GLOBAL";
    if (!sectionMap.has(cat)) {
      sectionMap.set(cat, []);
      orderedCats.push(cat);
    }
    const row: HelpRow = annotation
      ? { keys: b.keys, label, annotation }
      : { keys: b.keys, label };
    sectionMap.get(cat)!.push(row);
  }

  const sections: HelpSection[] = orderedCats.map((c) => ({
    category: c,
    rows: sectionMap.get(c) ?? [],
  }));
  const totalRows = sections.reduce((a, s) => a + s.rows.length, 0);
  return { sections, totalRows };
}

/** A toggleLabel receives whichever slice of `ctx.toggleState` makes sense
 *  for the binding. The approve binding narrows on `pendingApprovalsCount`
 *  as a number; log bindings narrow on `isFollowing`/`isWrapped`. We pass
 *  the full toggleState object; bindings narrow defensively (see
 *  keybar-fixtures/graph.ts). For the approve binding we also pass the raw
 *  count so existing fixture code `typeof state === "number"` path works. */
function resolveToggleTarget(b: Binding, ctx: AppContext): unknown {
  const keys0 = b.keys[0] ?? "";
  if (keys0 === "a") return ctx.pendingApprovalsCount ?? 0;
  if (keys0 === "f") return ctx.isFollowing;
  if (keys0 === "w") return ctx.isWrapped;
  return ctx.toggleState;
}

/** Small table-driven rules for help annotations. D6 in the plan. */
function annotateBinding(b: Binding, ctx: AppContext): string | undefined {
  const k = b.keys[0];
  if (k === "a" && (ctx.pendingApprovalsCount ?? 0) > 0) {
    return `(${ctx.pendingApprovalsCount} available)`;
  }
  return undefined;
}
