import { Liquid, LiquidError } from "liquidjs";
import { registerMarkdownFilters } from "./template-filters.js";

export interface TemplateContext {
  /** Flat string variables (inputs, MARKFLOW_*, LOCAL/GLOBAL JSON strings). */
  vars: Record<string, string>;
  /** Namespaced structured values exposed at the top of the Liquid scope
   * alongside flat vars — e.g. `GLOBAL`, `STEPS`. */
  namespaces?: Record<string, unknown>;
}

const engine = new Liquid({
  strictVariables: true,
  strictFilters: true,
});
registerMarkdownFilters(engine);

const TEMPLATE_HINT_RE = /\{\{|\{%/;

export function hasTemplateVars(text: string): boolean {
  return TEMPLATE_HINT_RE.test(text);
}

export function renderTemplate(
  text: string,
  context: Record<string, string> | TemplateContext,
  stepId: string,
): string {
  const ctx: TemplateContext = isTemplateContext(context)
    ? context
    : { vars: context, namespaces: {} };

  const scope: Record<string, unknown> = {
    ...ctx.vars,
    ...(ctx.namespaces ?? {}),
  };

  try {
    return engine.parseAndRenderSync(text, scope);
  } catch (err) {
    if (err instanceof LiquidError) {
      throw new Error(
        `Template error in step "${stepId}": ${err.message.trim()}`,
      );
    }
    throw err;
  }
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
