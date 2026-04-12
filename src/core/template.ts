// Supports two forms:
//   ${NAME}           flat string variable (inputs, env)
//   ${NS.path.to.x}   dotted path into a namespaced JSON object
//                     (e.g. ${GLOBAL.api_base}, ${STEPS.emit.state.cursor})
//   $${NAME}          literal — leaves `${NAME}` in output, no substitution
// First identifier must be UPPERCASE (flat var or namespace: GLOBAL, STEPS, ...).
// Subsequent dot-path segments may be any case (step IDs, state keys).
const IDENT = "[A-Z_][A-Z0-9_]*(?:\\.[\\w-]+)*";
const TEMPLATE_PATTERN = new RegExp(
  `\\$\\$\\{(${IDENT})\\}|\\$\\{(${IDENT})\\}`,
  "g",
);

export interface TemplateContext {
  /** Flat string variables (inputs, MARKFLOW_*, STATE/GLOBAL JSON strings). */
  vars: Record<string, string>;
  /** Namespaced structured values for dotted-path lookups. */
  namespaces?: Record<string, unknown>;
}

export function hasTemplateVars(text: string): boolean {
  TEMPLATE_PATTERN.lastIndex = 0;
  return TEMPLATE_PATTERN.test(text);
}

export function renderTemplate(
  text: string,
  context: Record<string, string> | TemplateContext,
  stepId: string,
): string {
  // Backwards-compatible: plain string-map callers get the old flat behavior.
  const ctx: TemplateContext = isTemplateContext(context)
    ? context
    : { vars: context, namespaces: {} };

  return text.replace(TEMPLATE_PATTERN, (_match, escaped, name: string) => {
    if (escaped !== undefined) return `\${${escaped}}`;

    const dotIdx = name.indexOf(".");
    if (dotIdx === -1) {
      // Flat variable
      if (!(name in ctx.vars)) {
        const available = Object.keys(ctx.vars).sort().join(", ");
        throw new Error(
          `Template variable "\${${name}}" in step "${stepId}" is not defined. Available: ${available}`,
        );
      }
      return ctx.vars[name];
    }

    // Dotted path: first segment is a namespace, rest is a deep lookup.
    const ns = name.slice(0, dotIdx);
    const path = name.slice(dotIdx + 1);
    const root = ctx.namespaces?.[ns];
    if (root === undefined) {
      const nsList = Object.keys(ctx.namespaces ?? {}).join(", ") || "(none)";
      throw new Error(
        `Template namespace "${ns}" in step "${stepId}" is not defined. Available namespaces: ${nsList}`,
      );
    }

    const value = lookupPath(root, path.split("."));
    if (value === undefined) {
      throw new Error(
        `Template path "\${${name}}" in step "${stepId}" resolved to undefined.`,
      );
    }
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

function isTemplateContext(
  value: Record<string, string> | TemplateContext,
): value is TemplateContext {
  return (
    typeof value === "object" &&
    value !== null &&
    "vars" in value &&
    typeof (value as TemplateContext).vars === "object"
  );
}

function lookupPath(root: unknown, segments: string[]): unknown {
  let cur: unknown = root;
  for (const seg of segments) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
    if (cur === undefined) return undefined;
  }
  return cur;
}
