import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Root, Heading, Code, List } from "mdast";
import type { StepDefinition, ScriptLang, InputDeclaration, StepAgentConfig } from "../types.js";
import { SUPPORTED_LANGS } from "../types.js";

export interface RawSections {
  name: string;
  description: string;
  inputs: InputDeclaration[];
  mermaidSource: string;
  steps: StepDefinition[];
}

/**
 * Parse a markdown workflow file into its raw sections.
 */
export function parseMarkdownSections(source: string): RawSections {
  const tree = unified().use(remarkParse).parse(source) as Root;
  const children = tree.children;

  // Find H1 heading — the workflow name
  const h1Index = children.findIndex(
    (n) => n.type === "heading" && n.depth === 1,
  );
  if (h1Index === -1) {
    throw new Error("Workflow file must have an H1 heading as the name");
  }
  const name = extractHeadingText(children[h1Index] as Heading);

  // Find # Flow, # Steps, and optional # Inputs section indices
  const flowIndex = findH1ByText(children, "Flow");
  const stepsIndex = findH1ByText(children, "Steps");
  const inputsIndex = findH1ByText(children, "Inputs");

  if (flowIndex === -1) {
    throw new Error('Workflow file must have a "# Flow" section');
  }
  if (stepsIndex === -1) {
    throw new Error('Workflow file must have a "# Steps" section');
  }

  // Extract description: prose between the first H1 and # Flow (headings are skipped)
  const description = extractTextBetween(source, children, h1Index, flowIndex);

  // Extract inputs from optional # Inputs section
  let inputs: InputDeclaration[] = [];
  if (inputsIndex !== -1) {
    const inputsEnd = findNextH1(children, inputsIndex + 1);
    inputs = extractInputs(children, inputsIndex, inputsEnd);
  }

  // Extract mermaid code block from the Flow section
  const flowEnd = findNextH1(children, flowIndex + 1);
  const mermaidBlock = findCodeBlock(children, flowIndex, flowEnd, "mermaid");
  if (!mermaidBlock) {
    throw new Error("# Flow section must contain a ```mermaid code block");
  }
  const mermaidSource = mermaidBlock.value;

  // Extract steps from the Steps section
  const stepsEnd = findNextH1(children, stepsIndex + 1);
  const steps = extractSteps(children, stepsIndex, stepsEnd);

  return { name, description, inputs, mermaidSource, steps };
}

function extractHeadingText(heading: Heading): string {
  return heading.children
    .map((c) => {
      if (c.type === "text") return c.value;
      if (c.type === "inlineCode") return c.value;
      return "";
    })
    .join("");
}

function findH1ByText(
  children: Root["children"],
  text: string,
): number {
  return children.findIndex(
    (n) =>
      n.type === "heading" &&
      n.depth === 1 &&
      extractHeadingText(n as Heading).trim().toLowerCase() ===
        text.toLowerCase(),
  );
}

function findNextH1(children: Root["children"], startIndex: number): number {
  for (let i = startIndex; i < children.length; i++) {
    if (children[i].type === "heading" && (children[i] as Heading).depth === 1) {
      return i;
    }
  }
  return children.length;
}

function findCodeBlock(
  children: Root["children"],
  start: number,
  end: number,
  lang: string,
): Code | null {
  for (let i = start; i < end; i++) {
    const node = children[i];
    if (node.type === "code" && node.lang === lang) {
      return node;
    }
  }
  return null;
}

function extractTextBetween(
  _source: string,
  children: Root["children"],
  startIndex: number,
  endIndex: number,
): string {
  const parts: string[] = [];
  for (let i = startIndex + 1; i < endIndex; i++) {
    const node = children[i];
    if (node.type === "paragraph") {
      parts.push(
        node.children
          .map((c) => {
            if (c.type === "text") return c.value;
            return "";
          })
          .join(""),
      );
    }
  }
  return parts.join("\n").trim();
}

function extractSteps(
  children: Root["children"],
  stepsStart: number,
  stepsEnd: number,
): StepDefinition[] {
  const steps: StepDefinition[] = [];
  let currentId: string | null = null;
  let currentNodes: Root["children"] = [];

  for (let i = stepsStart + 1; i < stepsEnd; i++) {
    const node = children[i];
    if (node.type === "heading" && (node as Heading).depth === 2) {
      // Flush previous step
      if (currentId) {
        steps.push(buildStep(currentId, currentNodes));
      }
      currentId = extractHeadingText(node as Heading).trim();
      currentNodes = [];
    } else if (currentId) {
      currentNodes.push(node);
    }
  }

  // Flush last step
  if (currentId) {
    steps.push(buildStep(currentId, currentNodes));
  }

  return steps;
}

function buildStep(id: string, nodes: Root["children"]): StepDefinition {
  // If the first code block has lang "config", extract it as per-step agent config
  const firstCode = nodes.find((n) => n.type === "code") as Code | undefined;
  let agentConfig: StepAgentConfig | undefined;
  let remainingNodes = nodes;

  if (firstCode?.lang === "config") {
    agentConfig = parseStepConfig(firstCode.value);
    remainingNodes = nodes.filter((n) => n !== firstCode);
  }

  // If a config block was present, the step is definitively an agent step —
  // any remaining code blocks are kept as prose content (e.g. templates, examples).
  if (agentConfig !== undefined) {
    const prose = collectProse(id, remainingNodes, /* includeCodeBlocks */ true);
    return { id, type: "agent", content: prose, agentConfig };
  }

  // No config block: look for a script code block to determine step type.
  const codeBlock = remainingNodes.find((n) => n.type === "code") as Code | undefined;

  if (codeBlock) {
    const lang = codeBlock.lang || "";
    if (!SUPPORTED_LANGS.includes(lang)) {
      throw new Error(
        `Step "${id}" uses unsupported language "${lang}". Supported: ${SUPPORTED_LANGS.join(", ")}`,
      );
    }
    return {
      id,
      type: "script",
      lang: lang as ScriptLang,
      content: codeBlock.value,
    };
  }

  // No code block — agent step, collect prose only.
  const prose = collectProse(id, remainingNodes, /* includeCodeBlocks */ false);
  return { id, type: "agent", content: prose };
}

function collectProse(
  _id: string,
  nodes: Root["children"],
  includeCodeBlocks: boolean,
): string {
  return nodes
    .map((n) => {
      if (n.type === "paragraph") {
        return n.children
          .map((c) => {
            if (c.type === "text") return c.value;
            if (c.type === "inlineCode") return c.value;
            return "";
          })
          .join("");
      }
      if (includeCodeBlocks && n.type === "code") {
        const fence = (n as Code).lang ? `\`\`\`${(n as Code).lang}` : "```";
        return `${fence}\n${(n as Code).value}\n\`\`\``;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function extractInputs(
  children: Root["children"],
  start: number,
  end: number,
): InputDeclaration[] {
  const inputs: InputDeclaration[] = [];

  for (let i = start + 1; i < end; i++) {
    const node = children[i];
    if (node.type !== "list") continue;

    for (const item of (node as List).children) {
      const para = item.children.find((c) => c.type === "paragraph");
      if (!para || para.type !== "paragraph") continue;

      // Reconstruct text, wrapping inlineCode in backticks for regex matching
      const text = para.children
        .map((c) => {
          if (c.type === "text") return c.value;
          if (c.type === "inlineCode") return `\`${c.value}\``;
          return "";
        })
        .join("");

      const decl = parseInputLine(text);
      if (decl) inputs.push(decl);
    }
  }

  return inputs;
}

function parseInputLine(line: string): InputDeclaration | null {
  // Matches: `NAME` (required): desc
  //          `NAME` (optional): desc
  //          `NAME` (default: "value"): desc
  //          `NAME` (default: `value`): desc
  const match = line.match(
    /^`([A-Z_][A-Z0-9_]*)`\s+\((required|optional|default:\s*(?:"([^"]*)"|`([^`]*)`))\):\s*(.+)$/i,
  );
  if (!match) return null;

  const name = match[1];
  const modifier = match[2].toLowerCase();
  const defaultVal = match[3] ?? match[4]; // [3] double-quoted, [4] backtick-quoted
  const description = match[5].trim();

  if (modifier === "required") {
    return { name, required: true, description };
  }
  if (modifier === "optional") {
    return { name, required: false, description };
  }
  // default: "value"
  return { name, required: false, default: defaultVal, description };
}

function parseStepConfig(yaml: string): StepAgentConfig {
  const config: StepAgentConfig = {};
  const lines = yaml.split("\n");
  let inFlags = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    const agentMatch = line.match(/^agent:\s*(.+)$/);
    if (agentMatch) {
      config.agent = agentMatch[1].trim();
      inFlags = false;
      continue;
    }

    if (/^flags:\s*$/.test(line)) {
      config.flags = [];
      inFlags = true;
      continue;
    }

    if (inFlags) {
      const itemMatch = line.match(/^\s+-\s+(.+)$/);
      if (itemMatch) {
        config.flags!.push(itemMatch[1].trim());
        continue;
      }
      if (!/^\s/.test(line)) inFlags = false;
    }
  }

  return config;
}
