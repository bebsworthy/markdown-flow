// src/palette/parser.ts
//
// Pure palette input parser (P7-T3).
//
// `":run foo"` → { head:"run", arg:"foo" }
// `":"`         → { head:"", arg:"" }
// `"run"`       → null (no leading colon)

export function parseInput(
  raw: string,
): { readonly head: string; readonly arg: string } | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith(":")) return null;
  const body = trimmed.slice(1).trimStart();
  const firstSpace = body.search(/\s/);
  if (firstSpace < 0) return { head: body, arg: "" };
  const head = body.slice(0, firstSpace);
  const arg = body.slice(firstSpace).trim().replace(/\s+/g, " ");
  return { head, arg };
}
