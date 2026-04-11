import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Root, Heading, Code } from "mdast";
import type { StepDefinition, ScriptLang } from "../types.js";
import { SUPPORTED_LANGS } from "../types.js";

export interface RawSections {
  name: string;
  description: string;
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

  // Find # Flow and # Steps section indices
  const flowIndex = findH1ByText(children, "Flow");
  const stepsIndex = findH1ByText(children, "Steps");

  if (flowIndex === -1) {
    throw new Error('Workflow file must have a "# Flow" section');
  }
  if (stepsIndex === -1) {
    throw new Error('Workflow file must have a "# Steps" section');
  }

  // Extract description: everything between the first H1 and # Flow
  const description = extractTextBetween(source, children, h1Index, flowIndex);

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

  return { name, description, mermaidSource, steps };
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
  // Look for a code block
  const codeBlock = nodes.find((n) => n.type === "code") as Code | undefined;

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

  // No code block — agent step, collect all prose
  const prose = nodes
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
      return "";
    })
    .filter(Boolean)
    .join("\n\n");

  return { id, type: "agent", content: prose };
}
