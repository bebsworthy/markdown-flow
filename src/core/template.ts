const TEMPLATE_PATTERN =
  /\$\$\{([A-Z_][A-Z0-9_]*)\}|\$\{([A-Z_][A-Z0-9_]*)\}/g;

export function hasTemplateVars(text: string): boolean {
  TEMPLATE_PATTERN.lastIndex = 0;
  return TEMPLATE_PATTERN.test(text);
}

export function renderTemplate(
  text: string,
  vars: Record<string, string>,
  stepId: string,
): string {
  return text.replace(TEMPLATE_PATTERN, (_match, escaped, name) => {
    if (escaped !== undefined) return `\${${escaped}}`;
    if (!(name in vars)) {
      const available = Object.keys(vars).sort().join(", ");
      throw new Error(
        `Template variable "\${${name}}" in step "${stepId}" is not defined. Available: ${available}`,
      );
    }
    return vars[name];
  });
}
