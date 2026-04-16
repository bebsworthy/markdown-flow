import type { Liquid } from "liquidjs";
import yaml from "js-yaml";
import { TemplateError } from "./errors.js";

function parseFields(csv: unknown): string[] {
  if (typeof csv !== "string" || !csv.trim()) return [];
  return csv.split(",").map((s) => s.trim()).filter(Boolean);
}

function pickFields(value: unknown, fields: string[]): unknown {
  if (!fields.length) return value;
  if (Array.isArray(value)) return value.map((v) => pickFields(v, fields));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const f of fields) out[f] = (value as Record<string, unknown>)[f];
    return out;
  }
  return value;
}

function stringifyCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function asArray(v: unknown, filter: string): unknown[] {
  if (!Array.isArray(v)) {
    throw new TemplateError(`${filter} filter expects an array, got ${typeof v}`);
  }
  return v;
}

export function registerMarkdownFilters(engine: Liquid): void {
  engine.registerFilter("json", (v: unknown, fieldsCsv?: string) =>
    JSON.stringify(pickFields(v, parseFields(fieldsCsv)), null, 2),
  );

  engine.registerFilter("yaml", (v: unknown, fieldsCsv?: string) =>
    yaml.dump(pickFields(v, parseFields(fieldsCsv)), { lineWidth: -1 }).trimEnd(),
  );

  engine.registerFilter("list", (v: unknown, fieldsCsv?: string) => {
    const arr = asArray(v, "list");
    const fields = parseFields(fieldsCsv);
    return arr
      .map((item) => {
        if (!fields.length) return `- ${stringifyCell(item)}`;
        const obj = (item ?? {}) as Record<string, unknown>;
        const [first, ...rest] = fields;
        const head = `\`${stringifyCell(obj[first])}\``;
        const tail = rest.length
          ? `: ${rest.map((f) => stringifyCell(obj[f])).join(" — ")}`
          : "";
        return `- ${head}${tail}`;
      })
      .join("\n");
  });

  engine.registerFilter("table", (v: unknown, fieldsCsv?: string) => {
    const arr = asArray(v, "table");
    const fields = parseFields(fieldsCsv);
    if (!fields.length) {
      throw new TemplateError("table filter requires at least one field name");
    }
    const header = `| ${fields.join(" | ")} |`;
    const sep = `| ${fields.map(() => "---").join(" | ")} |`;
    const rows = arr.map((item) => {
      const obj = (item ?? {}) as Record<string, unknown>;
      return `| ${fields.map((f) => escapeCell(stringifyCell(obj[f]))).join(" | ")} |`;
    });
    return [header, sep, ...rows].join("\n");
  });

  engine.registerFilter("code", (v: unknown, lang?: string) => {
    const fence = typeof lang === "string" ? lang : "";
    return `\`\`\`${fence}\n${String(v ?? "")}\n\`\`\``;
  });

  engine.registerFilter("heading", (v: unknown, level: number = 1) => {
    const n = Math.max(1, Math.min(6, Math.floor(Number(level) || 1)));
    return `${"#".repeat(n)} ${stringifyCell(v)}`;
  });

  engine.registerFilter("quote", (v: unknown) =>
    String(v ?? "")
      .split("\n")
      .map((l) => `> ${l}`)
      .join("\n"),
  );

  engine.registerFilter("indent", (v: unknown, n: number = 2) => {
    const pad = " ".repeat(Math.max(0, Math.floor(Number(n) || 0)));
    return String(v ?? "")
      .split("\n")
      .map((l) => pad + l)
      .join("\n");
  });

  engine.registerFilter("pluck", (v: unknown, field: string) => {
    const arr = asArray(v, "pluck");
    return arr.map((x) =>
      x && typeof x === "object" ? (x as Record<string, unknown>)[field] : undefined,
    );
  });

  engine.registerFilter("keys", (v: unknown) =>
    v && typeof v === "object" ? Object.keys(v as object) : [],
  );

  engine.registerFilter("values", (v: unknown) =>
    v && typeof v === "object" ? Object.values(v as object) : [],
  );
}
