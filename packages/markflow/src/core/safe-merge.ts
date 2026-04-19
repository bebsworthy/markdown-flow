const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function safeMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(source)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    target[key] = source[key];
  }
}
