import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseMarkdownSections } from "./markdown.js";
import { parseMermaidFlowchart } from "./mermaid.js";
import type { WorkflowDefinition } from "../types.js";

export function parseWorkflowFromString(
  source: string,
  filePath = "<string>",
): WorkflowDefinition {
  const sections = parseMarkdownSections(source);
  const graph = parseMermaidFlowchart(sections.mermaidSource);
  const steps = new Map(sections.steps.map((s) => [s.id, s]));

  return {
    name: sections.name,
    description: sections.description,
    inputs: sections.inputs,
    graph,
    steps,
    sourceFile: filePath,
  };
}

export async function parseWorkflow(
  filePath: string,
): Promise<WorkflowDefinition> {
  const absPath = resolve(filePath);
  const source = await readFile(absPath, "utf-8");
  return parseWorkflowFromString(source, absPath);
}
