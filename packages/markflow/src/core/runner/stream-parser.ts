import { safeMerge } from "../safe-merge.js";

const SENTINEL_RE = /^(LOCAL|GLOBAL|RESULT):\s*(.*)/;

export interface ParsedStream {
  local: Record<string, unknown>;
  global: Record<string, unknown>;
  result?: { edge?: string; summary?: string };
  errors: string[];
}

export interface StreamParser {
  feed(chunk: string): void;
  finish(): ParsedStream;
}

function countBraces(text: string): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  return depth;
}

export function createStreamParser(): StreamParser {
  const local: Record<string, unknown> = {};
  const global: Record<string, unknown> = {};
  const errors: string[] = [];
  let result: { edge?: string; summary?: string } | undefined;
  let buffer = "";

  let accumKind: "LOCAL" | "GLOBAL" | "RESULT" | null = null;
  let accumBuffer = "";
  let accumDepth = 0;

  const commitAccumulated = (): void => {
    if (accumKind === null) return;
    const json = accumBuffer;
    const kind = accumKind;
    accumKind = null;
    accumBuffer = "";
    accumDepth = 0;

    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      errors.push(
        `Unterminated or invalid JSON in ${kind} block.`,
      );
      return;
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return;
    }

    applyParsed(kind, parsed as Record<string, unknown>);
  };

  const abortAccumulated = (reason: string): void => {
    if (accumKind === null) return;
    errors.push(reason);
    accumKind = null;
    accumBuffer = "";
    accumDepth = 0;
  };

  const applyParsed = (kind: string, obj: Record<string, unknown>): void => {
    if (kind === "LOCAL") {
      safeMerge(local, obj);
    } else if (kind === "GLOBAL") {
      safeMerge(global, obj);
    } else {
      if ("local" in obj) {
        errors.push(
          `RESULT must not contain "local" — emit a separate LOCAL: line instead.`,
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

  const handleResultShorthand = (text: string): void => {
    if (result) {
      errors.push(`Multiple RESULT lines emitted; only the first is honored.`);
      return;
    }
    const pipeIdx = text.indexOf("|");
    if (pipeIdx === -1) {
      result = { edge: text.trim(), summary: undefined };
    } else {
      result = {
        edge: text.slice(0, pipeIdx).trim(),
        summary: text.slice(pipeIdx + 1).trim(),
      };
    }
  };

  const handleLine = (line: string): void => {
    if (accumKind !== null) {
      const sentinelMatch = line.match(SENTINEL_RE);
      if (sentinelMatch) {
        abortAccumulated(
          `Unterminated JSON in ${accumKind} block (new ${sentinelMatch[1]}: sentinel encountered).`,
        );
        processNewSentinel(sentinelMatch[1] as "LOCAL" | "GLOBAL" | "RESULT", sentinelMatch[2]);
        return;
      }
      accumBuffer += "\n" + line;
      accumDepth += countBraces(line);
      if (accumDepth === 0) {
        commitAccumulated();
      }
      return;
    }

    const match = line.match(SENTINEL_RE);
    if (!match) return;
    processNewSentinel(match[1] as "LOCAL" | "GLOBAL" | "RESULT", match[2]);
  };

  const processNewSentinel = (kind: "LOCAL" | "GLOBAL" | "RESULT", rest: string): void => {
    const trimmed = rest.trim();

    if (kind === "RESULT" && trimmed !== "" && !trimmed.startsWith("{")) {
      handleResultShorthand(trimmed);
      return;
    }

    if (trimmed === "") {
      accumKind = kind;
      accumBuffer = "";
      accumDepth = 0;
      return;
    }

    const depth = countBraces(trimmed);
    if (depth === 0) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return;
      }
      applyParsed(kind, parsed as Record<string, unknown>);
    } else {
      accumKind = kind;
      accumBuffer = trimmed;
      accumDepth = depth;
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
      if (accumKind !== null) {
        abortAccumulated(
          `Unterminated JSON in ${accumKind} block (unexpected end of output).`,
        );
      }
      return { local, global, result, errors };
    },
  };
}
