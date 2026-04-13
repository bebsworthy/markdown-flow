import { ConfigError } from "./errors.js";

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
};

const TOKEN_RE = /(\d+)([smh])/g;

/**
 * Parse a human-readable duration string into milliseconds.
 * Accepts concatenated unit tokens: "30s", "5m", "1h", "1h30m", "2h15m30s".
 * Throws ConfigError on unparseable input.
 */
export function parseDuration(input: string): number {
  if (typeof input !== "string") {
    throw new ConfigError(`Invalid duration: expected string, got ${typeof input}`);
  }
  const trimmed = input.trim().toLowerCase();
  if (trimmed === "") {
    throw new ConfigError("Invalid duration: empty string");
  }

  let total = 0;
  let consumed = 0;
  TOKEN_RE.lastIndex = 0;
  for (const match of trimmed.matchAll(TOKEN_RE)) {
    total += Number(match[1]) * UNIT_MS[match[2]];
    consumed += match[0].length;
  }

  if (consumed !== trimmed.length || total === 0) {
    throw new ConfigError(
      `Invalid duration "${input}": expected format like "30s", "5m", "1h", or "1h30m"`,
    );
  }
  return total;
}
