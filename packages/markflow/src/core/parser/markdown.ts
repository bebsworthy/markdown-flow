import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Root, Heading, Code, List } from "mdast";
import type { StepDefinition, ScriptLang, StepType, InputDeclaration, StepAgentConfig, StepConfig, StepApprovalConfig, RetryConfig, BackoffKind, ValidationDiagnostic, MarkflowConfig } from "../types.js";
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
        if (!step.content.trim() && step.type !== "approval") {
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
  // If the first code block has lang "config", extract agent + step config
  const firstCode = nodes.find((n) => n.type === "code") as Code | undefined;
  let agentConfig: StepAgentConfig | undefined;
  let stepConfig: StepConfig | undefined;
  let approvalConfig: StepApprovalConfig | undefined;
  let explicitType: StepType | undefined;
  let remainingNodes = nodes;

  if (firstCode?.lang === "config") {
    const parsed = parseStepConfig(firstCode.value);
    if (parsed.agent.agent !== undefined || parsed.agent.flags !== undefined) {
      agentConfig = parsed.agent;
    }
    if (
      parsed.step.timeout !== undefined ||
      parsed.step.retry !== undefined ||
      parsed.step.foreach !== undefined
    ) {
      stepConfig = parsed.step;
    }
    if (parsed.type !== undefined) {
      explicitType = parsed.type;
    }
    if (parsed.approval !== undefined) {
      approvalConfig = parsed.approval;
    }
    remainingNodes = nodes.filter((n) => n !== firstCode);
  }

  if (explicitType === "approval") {
    // Approval steps must not carry a runnable code block. Prose is allowed
    // and ignored (documentation for reviewers).
    const hasCode = remainingNodes.some((n) => n.type === "code");
    if (hasCode) {
      throw new ParseError(
        `Step "${id}" is type:approval and must not contain a code block. ` +
          `Move any executable logic to a separate step.`,
      );
    }
    if (agentConfig !== undefined) {
      throw new ParseError(
        `Step "${id}" is type:approval and cannot declare agent/flags.`,
      );
    }
    if (!approvalConfig || !approvalConfig.prompt) {
      throw new ParseError(
        `Step "${id}" is type:approval and must declare a non-empty \`prompt\` in its config block.`,
      );
    }
    if (!approvalConfig.options || approvalConfig.options.length === 0) {
      throw new ParseError(
        `Step "${id}" is type:approval and must declare at least one \`options\` entry.`,
      );
    }
    return {
      id,
      type: "approval",
      content: "",
      approvalConfig,
      line,
    };
  }

  // Classify as script only when the step's body is a single runnable code
  // block at the top (no prose before it). If a `config` block is present,
  // "top" means immediately after it. Anything else — prose, nested fences,
  // lists, etc. — is an agent step. This lets scripts carry a config block
  // (e.g. `timeout`) while still preserving agent prose verbatim.
  const firstRemaining = remainingNodes.find((n) => !isEmptyNode(n));
  const scriptCandidate =
    firstRemaining?.type === "code"
      ? (firstRemaining as Code)
      : agentConfig === undefined && stepConfig === undefined
        ? (remainingNodes.find((n) => n.type === "code") as Code | undefined)
        : undefined;

  if (scriptCandidate) {
    const lang = scriptCandidate.lang || "";
    if (!SUPPORTED_LANGS.includes(lang)) {
      // No config block: legacy behavior — unsupported lang is an error.
      // With a config block present, an unsupported/empty lang is treated as
      // embedded prose → fall through to agent classification.
      if (agentConfig === undefined && stepConfig === undefined) {
        throw new ParseError(
          `Step "${id}" uses unsupported language "${lang}". Supported: ${SUPPORTED_LANGS.join(", ")}`,
        );
      }
    } else {
      if (agentConfig !== undefined) {
        throw new ParseError(
          `Step "${id}" has a \`config\` block with agent/flags but is a script step. ` +
            `Agent settings apply only to agent (prose) steps.`,
        );
      }
      return {
        id,
        type: "script",
        lang: lang as ScriptLang,
        content: scriptCandidate.value,
        stepConfig,
        line,
      };
    }
  }

  // Agent step. Prose is everything after the config block (if present)
  // through the end of the step, sliced verbatim so lists, sub-headings,
  // quotes, and nested code fences survive intact.
  const prose = sliceRemainingSource(source, firstCode, remainingNodes);
  return { id, type: "agent", content: prose, agentConfig, stepConfig, line };
}

function isEmptyNode(n: Root["children"][number]): boolean {
  // Empty paragraph nodes can appear from blank lines; treat as non-content.
  if (n.type === "paragraph" && (!("children" in n) || n.children.length === 0)) {
    return true;
  }
  return false;
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

    const timeoutMatch = line.match(/^timeout_default:\s*(.+)$/);
    if (timeoutMatch) {
      config.timeoutDefault = timeoutMatch[1].trim();
      continue;
    }
  }

  return config;
}

function parseStepConfig(yaml: string): {
  agent: StepAgentConfig;
  step: StepConfig;
  type?: StepType;
  approval?: StepApprovalConfig;
} {
  const agent: StepAgentConfig = {};
  const step: StepConfig = {};
  let type: StepType | undefined;
  let prompt: string | undefined;
  let options: string[] | undefined;
  const lines = yaml.split("\n");
  let inFlags = false;
  let inRetry = false;
  let inOptions = false;
  let inForeach = false;
  let retry: RetryConfig | undefined;
  let foreach: import("../types.js").ForEachConfig | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    const agentMatch = line.match(/^agent:\s*(.+)$/);
    if (agentMatch) {
      agent.agent = agentMatch[1].trim();
      inFlags = false;
      inRetry = false;
      continue;
    }

    if (/^flags:\s*$/.test(line)) {
      agent.flags = [];
      inFlags = true;
      inRetry = false;
      continue;
    }

    if (inFlags) {
      const itemMatch = line.match(/^\s+-\s+(.+)$/);
      if (itemMatch) {
        agent.flags!.push(itemMatch[1].trim());
        continue;
      }
      if (!/^\s/.test(line)) inFlags = false;
    }

    if (/^retry:\s*$/.test(line)) {
      retry = { max: 0 };
      inRetry = true;
      inFlags = false;
      inForeach = false;
      continue;
    }

    if (/^foreach:\s*$/.test(line)) {
      foreach = { onItemError: "fail-fast" };
      inForeach = true;
      inRetry = false;
      inFlags = false;
      inOptions = false;
      continue;
    }

    if (inForeach) {
      const indented = line.match(/^\s+(\w+):\s*(.+)$/);
      if (indented) {
        const key = indented[1];
        const val = indented[2].trim();
        if (key === "onItemError") {
          if (val !== "fail-fast" && val !== "continue") {
            throw new ParseError(
              `foreach.onItemError must be "fail-fast" or "continue" (got "${val}")`,
            );
          }
          foreach!.onItemError = val;
        } else if (key === "maxConcurrency") {
          const n = Number(val);
          if (!Number.isInteger(n) || n < 0) {
            throw new ParseError(
              `foreach.maxConcurrency must be a non-negative integer (got "${val}")`,
            );
          }
          foreach!.maxConcurrency = n;
        }
        continue;
      }
      if (!/^\s/.test(line)) inForeach = false;
    }

    if (inRetry) {
      const indented = line.match(/^\s+(\w+):\s*(.+)$/);
      if (indented) {
        const key = indented[1];
        const val = indented[2].trim();
        if (key === "max") {
          retry!.max = Number(val);
        } else if (key === "delay") {
          retry!.delay = val;
        } else if (key === "backoff") {
          retry!.backoff = val as BackoffKind;
        } else if (key === "maxDelay") {
          retry!.maxDelay = val;
        } else if (key === "jitter") {
          retry!.jitter = Number(val);
        }
        continue;
      }
      // Non-indented line → retry block ended
      inRetry = false;
    }

    const timeoutMatch = line.match(/^timeout:\s*(.+)$/);
    if (timeoutMatch) {
      step.timeout = timeoutMatch[1].trim();
      inFlags = false;
      inRetry = false;
      continue;
    }

    const typeMatch = line.match(/^type:\s*(.+)$/);
    if (typeMatch) {
      const raw = typeMatch[1].trim();
      if (raw === "script" || raw === "agent" || raw === "approval") {
        type = raw;
      } else {
        throw new ParseError(
          `Unknown step type "${raw}". Supported: script, agent, approval.`,
        );
      }
      inFlags = false;
      inRetry = false;
      inOptions = false;
      continue;
    }

    const promptMatch = line.match(/^prompt:\s*(.+)$/);
    if (promptMatch) {
      let raw = promptMatch[1].trim();
      // Strip surrounding quotes if present
      if (
        (raw.startsWith('"') && raw.endsWith('"')) ||
        (raw.startsWith("'") && raw.endsWith("'"))
      ) {
        raw = raw.slice(1, -1);
      }
      prompt = raw;
      inFlags = false;
      inRetry = false;
      inOptions = false;
      continue;
    }

    if (/^options:\s*$/.test(line)) {
      options = [];
      inOptions = true;
      inFlags = false;
      inRetry = false;
      continue;
    }

    if (inOptions) {
      const itemMatch = line.match(/^\s+-\s+(.+)$/);
      if (itemMatch) {
        let v = itemMatch[1].trim();
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }
        options!.push(v);
        continue;
      }
      if (!/^\s/.test(line)) inOptions = false;
    }
  }

  if (retry && retry.max > 0) {
    step.retry = retry;
  }

  if (foreach) {
    step.foreach = foreach;
  }

  const approval: StepApprovalConfig | undefined =
    prompt !== undefined || options !== undefined
      ? { prompt: prompt ?? "", options: options ?? [] }
      : undefined;

  return { agent, step, type, approval };
}
