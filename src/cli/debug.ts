import * as readline from "node:readline";
import chalk from "chalk";
import type {
  BeforeStepContext,
  BeforeStepDirective,
  BeforeStepHook,
} from "../core/index.js";

const SECRET_RE = /KEY|TOKEN|SECRET|PASSWORD/i;

function maskValue(key: string, value: string): string {
  return SECRET_RE.test(key) ? "***" : value;
}

function renderHeader(ctx: BeforeStepContext): void {
  const divider = "─".repeat(58);
  console.log(chalk.dim(divider));
  console.log(
    chalk.bold(
      `▶  ${ctx.nodeId}  ${chalk.dim(`[${ctx.step.type}]`)}  ${chalk.dim(`(call ${ctx.callCount})`)}`,
    ),
  );

  const inputEntries = Object.entries(ctx.resolvedInputs);
  if (inputEntries.length > 0) {
    const parts = inputEntries.map(([k, v]) => `${k}=${maskValue(k, v)}`);
    console.log(chalk.dim(`   Inputs:  ${parts.join("  ")}`));
  }

  const edgeLabels = ctx.outgoingEdges
    .filter((e) => e.label && !e.annotations.isExhaustionHandler)
    .map((e) => e.label!);
  const fallback = ctx.outgoingEdges.filter((e) => !e.label).length;
  const edgeSummary =
    edgeLabels.length > 0
      ? edgeLabels.join("  ")
      : fallback > 0
        ? `(unlabelled → ${ctx.outgoingEdges.map((e) => e.to).join(", ")})`
        : "(terminal)";
  console.log(chalk.dim(`   Edges:   ${edgeSummary}`));

  const prev = ctx.completedResults[ctx.completedResults.length - 1];
  if (prev) {
    console.log(chalk.dim(`   Prev:    ${prev.node} → ${prev.edge}`));
  } else {
    console.log(chalk.dim(`   Prev:    (none)`));
  }
  console.log(chalk.dim(divider));
}

function renderInspect(ctx: BeforeStepContext): void {
  console.log();
  if (ctx.step.type === "script") {
    console.log(chalk.bold(`Script (${ctx.step.lang ?? "bash"}):`));
    console.log(ctx.step.content);
  } else {
    console.log(chalk.bold("Agent prompt:"));
    console.log(ctx.prompt ?? ctx.step.content);
  }
  console.log();
}

export class WorkflowAbortError extends Error {
  constructor() {
    super("Workflow aborted by debugger");
    this.name = "WorkflowAbortError";
  }
}

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function promptSkip(
  rl: readline.Interface,
  ctx: BeforeStepContext,
): Promise<BeforeStepDirective> {
  const validEdges = ctx.outgoingEdges
    .filter((e) => e.label && !e.annotations.isExhaustionHandler)
    .map((e) => e.label!);

  while (true) {
    const hint = validEdges.length > 0 ? ` (${validEdges.join("|")})` : "";
    const edge = (await prompt(rl, `  edge${hint}: `)).trim();
    if (!edge) {
      console.log(chalk.yellow("  Edge required."));
      continue;
    }
    if (validEdges.length > 0 && !validEdges.includes(edge)) {
      console.log(
        chalk.yellow(`  "${edge}" not in ${validEdges.join(", ")}. Try again.`),
      );
      continue;
    }
    const summary = (await prompt(rl, `  summary (optional): `)).trim();
    return { edge, summary: summary || undefined };
  }
}

export interface DebugHookOptions {
  breakOn?: string;
}

export function createDebugHook(options: DebugHookOptions = {}): {
  hook: BeforeStepHook;
  close: () => void;
} {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const hook: BeforeStepHook = async (ctx) => {
    if (options.breakOn && ctx.nodeId !== options.breakOn) {
      return;
    }

    renderHeader(ctx);

    while (true) {
      const input = (
        await prompt(rl, chalk.cyan("[c]ontinue  [i]nspect  [s]kip  [q]uit  › "))
      )
        .trim()
        .toLowerCase();

      if (input === "c" || input === "") return;
      if (input === "i") {
        renderInspect(ctx);
        continue;
      }
      if (input === "s") {
        return promptSkip(rl, ctx);
      }
      if (input === "q") {
        throw new WorkflowAbortError();
      }
      console.log(chalk.yellow("  Unknown command."));
    }
  };

  return {
    hook,
    close: () => rl.close(),
  };
}
