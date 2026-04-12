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

  // Retry status
  const activeRetries = ctx.retryBudgets.filter((b) => b.count > 0);
  if (activeRetries.length > 0) {
    const parts = activeRetries.map(
      (b) => `${b.label} (attempt ${b.count + 1} of ${b.max + 1})`,
    );
    console.log(chalk.yellow(`   Retry:   ${parts.join("  ")}`));
  }

  // Inputs
  const inputEntries = Object.entries(ctx.resolvedInputs);
  if (inputEntries.length > 0) {
    const parts = inputEntries.map(([k, v]) => `${k}=${maskValue(k, v)}`);
    console.log(chalk.dim(`   Inputs:  ${parts.join("  ")}`));
  }

  // Runtime vars
  const runtimeVars = Object.entries(ctx.env)
    .filter(([k]) => k.startsWith("MARKFLOW_"))
    .map(([k, v]) => `${k.replace("MARKFLOW_", "")}=${v}`);
  if (runtimeVars.length > 0) {
    console.log(chalk.dim(`   Runtime: ${runtimeVars.join("  ")}`));
  }

  // Outgoing edges with full annotations
  const normal = ctx.outgoingEdges.filter(
    (e) => !e.annotations.isExhaustionHandler,
  );
  const exhaustion = ctx.outgoingEdges.filter(
    (e) => e.annotations.isExhaustionHandler,
  );

  const edgeParts = normal.map((e) => {
    let s = e.label ?? "(unlabelled)";
    if (e.annotations.maxRetries !== undefined) s += ` max:${e.annotations.maxRetries}`;
    const budget = ctx.retryBudgets.find((b) => b.label === e.label);
    if (budget && budget.count > 0) s += chalk.yellow(` (${budget.count}/${budget.max})`);
    s += ` → ${e.to}`;
    return s;
  });
  const exhaustParts = exhaustion.map((e) => {
    const src = e.annotations.exhaustionLabel ?? "?";
    return chalk.dim(`${src}:max → ${e.to}`);
  });
  const allEdges = [...edgeParts, ...exhaustParts];
  console.log(
    chalk.dim(`   Edges:   ${allEdges.length > 0 ? allEdges.join("  ") : "(terminal)"}`),
  );

  // Previous step
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
    const ac = ctx.step.agentConfig;
    if (ac) {
      const agentName = ac.agent ?? "(default)";
      const flags = ac.flags?.length ? ac.flags.join(" ") : "(none)";
      console.log(chalk.dim(`Agent: ${agentName}  Flags: ${flags}`));
    }
    console.log(chalk.bold("Agent prompt:"));
    console.log(ctx.prompt ?? ctx.step.content);
  }
  console.log();
}

function renderTrace(ctx: BeforeStepContext): void {
  console.log();
  if (ctx.completedResults.length === 0) {
    console.log(chalk.dim(`  (start) → ▶ ${ctx.nodeId}`));
  } else {
    const parts = ctx.completedResults.map(
      (r) => `${r.node} ${chalk.dim(`[${r.edge}]`)}`,
    );
    parts.push(`▶ ${ctx.nodeId}`);
    console.log(`  ${parts.join(" → ")}`);
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

  if (validEdges.length === 0) {
    const summary = (await prompt(rl, `  summary (optional): `)).trim();
    return { edge: "done", summary: summary || undefined };
  }

  while (true) {
    const hint = ` (${validEdges.join("|")})`;
    const edge = (await prompt(rl, `  edge${hint}: `)).trim();
    if (!edge) {
      console.log(chalk.yellow("  Edge required."));
      continue;
    }
    if (!validEdges.includes(edge)) {
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
        await prompt(rl, chalk.cyan("[c]ontinue  [i]nspect  [s]kip  [t]race  [q]uit  › "))
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
      if (input === "t") {
        renderTrace(ctx);
        continue;
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
