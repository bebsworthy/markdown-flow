import { readFile } from "node:fs/promises";

/**
 * Load and parse a .env file. Returns an empty record if the file does not
 * exist or cannot be read (so callers can safely try optional files).
 */
export async function loadEnvFile(
  filePath: string,
): Promise<Record<string, string>> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return {};
  }
  return parseEnvContent(content);
}

/**
 * Parse the contents of a .env file into a key/value record.
 *
 * Supported syntax:
 *   KEY=value
 *   KEY="quoted value"
 *   KEY='single quoted'
 *   # comment lines and blank lines are skipped
 */
export function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (!key) continue;

    let value = line.slice(eq + 1).trim();

    // Strip matching surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}
