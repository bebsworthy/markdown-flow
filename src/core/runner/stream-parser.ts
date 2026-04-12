const SENTINEL_RE = /^(STATE|GLOBAL|RESULT):\s*(\{.*\})\s*$/;

export interface ParsedStream {
  state: Record<string, unknown>;
  global: Record<string, unknown>;
  result?: { edge?: string; summary?: string };
  errors: string[];
}

export interface StreamParser {
  feed(chunk: string): void;
  finish(): ParsedStream;
}

export function createStreamParser(): StreamParser {
  const state: Record<string, unknown> = {};
  const global: Record<string, unknown> = {};
  const errors: string[] = [];
  let result: { edge?: string; summary?: string } | undefined;
  let buffer = "";

  const handleLine = (line: string): void => {
    const match = line.match(SENTINEL_RE);
    if (!match) return;
    const [, kind, json] = match;

    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      // Malformed JSON on a sentinel-looking line is silently ignored —
      // treat the line as prose (prompts, docs, agent chatter may echo
      // "STATE: {...}" style text without meaning to emit).
      return;
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return;
    }

    const obj = parsed as Record<string, unknown>;

    if (kind === "STATE") {
      Object.assign(state, obj);
    } else if (kind === "GLOBAL") {
      Object.assign(global, obj);
    } else {
      if ("state" in obj) {
        errors.push(
          `RESULT must not contain "state" — emit a separate STATE: line instead.`,
        );
      }
      if ("global" in obj) {
        errors.push(
          `RESULT must not contain "global" — emit a separate GLOBAL: line instead.`,
        );
      }
      if (result) {
        errors.push(`Multiple RESULT lines emitted; only the first is honored.`);
        return;
      }
      result = {
        edge: typeof obj.edge === "string" ? obj.edge : undefined,
        summary: typeof obj.summary === "string" ? obj.summary : undefined,
      };
    }
  };

  return {
    feed(chunk: string): void {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        handleLine(line.replace(/\r$/, ""));
      }
    },
    finish(): ParsedStream {
      if (buffer.length > 0) {
        handleLine(buffer.replace(/\r$/, ""));
        buffer = "";
      }
      return { state, global, result, errors };
    },
  };
}
