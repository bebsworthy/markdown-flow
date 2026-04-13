import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Root, Heading, Code, List } from "mdast";
import type { StepDefinition, ScriptLang, InputDeclaration, StepAgentConfig, ValidationDiagnostic, MarkflowConfig } from "../types.js";
import { SUPPORTED_LANGS } from "../types.js";
import { ParseError } from "../errors.js";

export interface RawSections {
  name: string;
  description: string;
  inputs: InputDeclaration[];
  mermaidSource: string;
  steps: StepDefinition[];
  configDefaults?: Partial<MarkflowConfig>;
  parserDiagnostics: ValidationDiagnostic[];
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
    throw new ParseError("Workflow file must have an H1 heading as the name");
  }
  const name = extractHeadingText(children[h1Index] as Heading);

  // Find # Flow, # Steps, and optional # Inputs section indices
  const flowIndex = findH1ByText(children, "Flow");
  const stepsIndex = findH1ByText(children, "Steps");
  const inputsIndex = findH1ByText(children, "Inputs");

  if (flowIndex === -1) {
    throw new ParseError('Workflow file must have a "# Flow" section');
  }
  if (stepsIndex === -1) {
    throw new ParseError('Workflow file must have a "# Steps" section');
  }

  // Extract description: prose between the first H1 and # Flow (headings are skipped)
  const description = extractTextBetween(source, children, h1Index, flowIndex);

  // Optional top-level ```config block between the H1 and # Flow
  const topConfigBlock = findCodeBlock(children, h1Index + 1, flowIndex, "config");
  const configDefaults = topConfigBlock
    ? parseTopConfig(topConfigBlock.value)
    : undefined;

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
    throw new ParseError("# Flow section must contain a ```mermaid code block");
  }
  const mermaidSource = mermaidBlock.value;
  if (!mermaidSource.trim()) {
    throw new ParseError("# Flow mermaid block is empty — add a flowchart definition");
  }

  // Extract steps from the Steps section
  const stepsEnd = findNextH1(children, stepsIndex + 1);
  const { steps, diagnostics: stepDiagnostics } = extractSteps(source, children, stepsIndex, stepsEnd);

  return { name, description, inputs, mermaidSource, steps, configDefaults, parserDiagnostics: stepDiagnostics };
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
  source: string,
  children: Root["children"],
  stepsStart: number,
  stepsEnd: number,
): { steps: StepDefinition[]; diagnostics: ValidationDiagnostic[] } {
  const steps: StepDefinition[] = [];
  const diagnostics: ValidationDiagnostic[] = [];
  const seenIds = new Map<string, number>();
  let currentId: string | null = null;
  let currentLine: number | undefined;
  let currentNodes: Root["children"] = [];

  for (let i = stepsStart + 1; i < stepsEnd; i++) {
    const node = children[i];
    if (node.type === "heading" && (node as Heading).depth === 2) {
      if (currentId) {
        const step = buildStep(source, currentId, currentNodes, currentLine);
        steps.push(step);
        if (!step.content.trim()) {
          diagnostics.push({
            severity: "warning",
            message: `Step "${currentId}" has no content`,
            nodeId: currentId,
            line: currentLine,
            suggestion: "Add a script code block or agent prompt to this step",
          });
        }
      }
      currentId = extractHeadingText(node as Heading).trim();
      currentLine = (node as Heading).position?.start?.line;
      currentNodes = [];

      if (currentId) {
        const prevLine = seenIds.get(currentId);
        if (prevLine !== undefined) {
          diagnostics.push({
            severity: "error",
            message: `Duplicate step definition "${currentId}" (first defined on line ${prevLine})`,
            nodeId: currentId,
            line: currentLine,
            suggestion: `Rename one of the "## ${currentId}" headings`,
          });
        } else {
          seenIds.set(currentId, currentLine ?? 0);
        }
      }
    } else if (currentId) {
      currentNodes.push(node);
    }
  }

  if (currentId) {
    const step = buildStep(source, currentId, currentNodes, currentLine);
    steps.push(step);
    if (!step.content.trim()) {
      diagnostics.push({
        severity: "warning",
        message: `Step "${currentId}" has no content`,
        nodeId: currentId,
        line: currentLine,
        suggestion: "Add a script code block or agent prompt to this step",
      });
    }
  }

  return { steps, diagnostics };
}

function buildStep(
  source: string,
  id: string,
  nodes: Root["children"],
  line?: number,
): StepDefinition {
  // If the first code block has lang "config", extract it as per-step agent config
  const firstCode = nodes.find((n) => n.type === "code") as Code | undefined;
  let agentConfig: StepAgentConfig | undefined;
  let remainingNodes = nodes;

  if (firstCode?.lang === "config") {
    agentConfig = parseStepConfig(firstCode.value);
    remainingNodes = nodes.filter((n) => n !== firstCode);
  }

  // If a config block was present, the step is definitively an agent step —
  // the agent prompt is EVERYTHING between the config block and the next H2,
  // sliced verbatim from the source so lists, sub-headings, quotes, and nested
  // code fences survive intact.
  if (agentConfig !== undefined) {
    const prose = sliceRemainingSource(source, firstCode, remainingNodes);
    return { id, type: "agent", content: prose, agentConfig, line };
  }

  // No config block: look for a script code block to determine step type.
  const codeBlock = remainingNodes.find((n) => n.type === "code") as Code | undefined;

  if (codeBlock) {
    const lang = codeBlock.lang || "";
    if (!SUPPORTED_LANGS.includes(lang)) {
      throw new ParseError(
        `Step "${id}" uses unsupported language "${lang}". Supported: ${SUPPORTED_LANGS.join(", ")}`,
      );
    }
    return {
      id,
      type: "script",
      lang: lang as ScriptLang,
      content: codeBlock.value,
      line,
    };
  }

  // No code block — pure prose agent step. Slice from source verbatim.
  const prose = sliceRemainingSource(source, undefined, remainingNodes);
  return { id, type: "agent", content: prose, line };
}

/**
 * Slice the original markdown source from just after `afterNode` (or from
 * the first remaining node if `afterNode` is undefined) through the last
 * remaining node. Preserves all markdown structure (lists, headings, code
 * fences, blockquotes) verbatim.
 */
function sliceRemainingSource(
  source: string,
  afterNode: Code | undefined,
  remainingNodes: Root["children"],
): string {
  if (remainingNodes.length === 0) return "";

  const startOffset =
    afterNode?.position?.end?.offset ??
    remainingNodes[0].position?.start?.offset ??
    0;
  const endOffset =
    remainingNodes[remainingNodes.length - 1].position?.end?.offset ??
    source.length;

  return source.slice(startOffset, endOffset).trim();
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

function parseTopConfig(yaml: string): Partial<MarkflowConfig> {
  const config: Partial<MarkflowConfig> = {};
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
      config.agentFlags = [];
      inFlags = true;
      continue;
    }

    if (inFlags) {
      const itemMatch = line.match(/^\s+-\s+(.+)$/);
      if (itemMatch) {
        config.agentFlags!.push(itemMatch[1].trim());
        continue;
      }
      if (!/^\s/.test(line)) inFlags = false;
    }

    const parallelMatch = line.match(/^parallel:\s*(true|false)\s*$/i);
    if (parallelMatch) {
      config.parallel = parallelMatch[1].toLowerCase() === "true";
      continue;
    }

    const retriesMatch = line.match(/^max_retries_default:\s*(\d+)\s*$/);
    if (retriesMatch) {
      config.maxRetriesDefault = Number(retriesMatch[1]);
      continue;
    }
  }

  return config;
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
