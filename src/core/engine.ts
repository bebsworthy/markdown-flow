import type {
  WorkflowDefinition,
  MarkflowConfig,
  EngineEventHandler,
  Token,
  StepResult,
  RunInfo,
  BeforeStepHook,
  BeforeStepContext,
  StepOutput,
} from "./types.js";
import { getOutgoingEdges, getStartNodes, getUpstreamNodes, isMergeNode } from "./graph.js";
import { resolveRoute, createRetryState, type RetryState } from "./router.js";
import { runStep } from "./runner/index.js";
import { assembleAgentPrompt } from "./runner/agent.js";
import { createRunManager, type RunDirectory } from "./run-manager.js";
import { loadConfig } from "./config.js";
import { loadEnvFile } from "./env.js";
import { join } from "node:path";

export interface EngineOptions {
  config?: Partial<MarkflowConfig>;
  runsDir?: string;
  onEvent?: EngineEventHandler;
  /** Workspace directory — loads <workspaceDir>/.env as layer 3. */
  workspaceDir?: string;
  /** Extra env file to load (layer 4, overrides workspace .env). */
  envFile?: string;
  /** Explicit key/value overrides — highest priority. */
  inputs?: Record<string, string>;
  /**
   * Called before each step executes. Return void to run the step normally,
   * or a mock directive to short-circuit execution with a synthetic result.
   * Used by the interactive debugger and the test harness.
   */
  beforeStep?: BeforeStepHook;
}

export async function executeWorkflow(
  definition: WorkflowDefinition,
  options: EngineOptions = {},
): Promise<RunInfo> {
  const engine = new WorkflowEngine(definition, options);
  return engine.start();
}

export class WorkflowEngine {
  private def: WorkflowDefinition;
  private options: EngineOptions;
  private config!: MarkflowConfig;
  private retryState!: RetryState;
  private runDir!: RunDirectory;
  private tokens: Map<string, Token> = new Map();
  private completedResults: StepResult[] = [];
  private globalContext: Record<string, unknown> = {};
  private tokenCounter = 0;
  private resolvedInputs: Record<string, string> = {};

  /** Per-node execution counts (nodeId → count). */
  private nodeCalls: Map<string, number> = new Map();

  /** Track which upstream nodes have completed for each merge node */
  private mergeCompletions: Map<string, Set<string>> = new Map();

  /** Track which upstream nodes have resolved (completed or skipped) */
  private resolvedNodes: Set<string> = new Set();

  constructor(definition: WorkflowDefinition, options: EngineOptions = {}) {
    this.def = definition;
    this.options = options;
  }

  async start(): Promise<RunInfo> {
    // Load config
    const fileConfig = await loadConfig(this.def.sourceFile);
    this.config = { ...fileConfig, ...this.options.config } as MarkflowConfig;

    // Resolve workflow inputs through the layered source stack
    this.resolvedInputs = await this.resolveInputs();

    // Create run directory
    const runManager = createRunManager(this.options.runsDir);
    this.runDir = await runManager.createRun(this.def);

    this.retryState = createRetryState();

    try {
      // Find start nodes and create initial tokens
      const startNodes = getStartNodes(this.def.graph);
      if (startNodes.length === 0) {
        throw new Error("Workflow has no start nodes (no nodes without incoming edges)");
      }

      for (const nodeId of startNodes) {
        this.createToken(nodeId);
      }

      // Main execution loop
      await this.runLoop();

      // Complete
      await runManager.completeRun(this.runDir.id, "complete");
      this.emit({
        type: "workflow:complete",
        results: this.completedResults,
      });

      return {
        id: this.runDir.id,
        workflowName: this.def.name,
        sourceFile: this.def.sourceFile,
        status: "complete",
        startedAt: this.runDir.id,
        steps: this.completedResults,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const runManager2 = createRunManager(this.options.runsDir);
      await runManager2.completeRun(this.runDir.id, "error");
      this.emit({ type: "workflow:error", error: message });

      return {
        id: this.runDir.id,
        workflowName: this.def.name,
        sourceFile: this.def.sourceFile,
        status: "error",
        startedAt: this.runDir.id,
        steps: this.completedResults,
      };
    }
  }

  private async runLoop(): Promise<void> {
    while (true) {
      const readyTokens = this.getReadyTokens();
      if (readyTokens.length === 0) {
        // Check if there are still pending tokens (waiting for merge)
        const pending = [...this.tokens.values()].filter(
          (t) => t.state === "pending",
        );
        if (pending.length > 0) {
          // This shouldn't happen in a well-formed workflow
          throw new Error(
            `Deadlock: ${pending.length} pending tokens but none are ready. ` +
            `Nodes: ${pending.map((t) => t.nodeId).join(", ")}`,
          );
        }
        break;
      }

      if (this.config.parallel && readyTokens.length > 1) {
        // Run in parallel
        await Promise.all(readyTokens.map((t) => this.executeToken(t)));
      } else {
        // Run sequentially
        for (const token of readyTokens) {
          await this.executeToken(token);
        }
      }
    }
  }

  private getReadyTokens(): Token[] {
    const ready: Token[] = [];

    for (const token of this.tokens.values()) {
      if (token.state !== "pending") continue;

      if (isMergeNode(this.def.graph, token.nodeId)) {
        // Merge node: all upstream nodes must be resolved
        const upstreams = getUpstreamNodes(this.def.graph, token.nodeId);
        const allResolved = upstreams.every((u) => this.resolvedNodes.has(u));
        if (allResolved) {
          ready.push(token);
        }
      } else {
        // Non-merge node: always ready if pending
        ready.push(token);
      }
    }

    return ready;
  }

  private async executeToken(token: Token): Promise<void> {
    const step = this.def.steps.get(token.nodeId);
    if (!step) {
      throw new Error(`No step definition for node "${token.nodeId}"`);
    }

    token.state = "running";
    this.emit({ type: "step:start", nodeId: token.nodeId, tokenId: token.id });

    const startedAt = new Date().toISOString();

    // Build environment variables for script steps
    const env: Record<string, string> = {
      ...this.resolvedInputs,
      MARKFLOW_STEP: token.nodeId,
      MARKFLOW_RUNDIR: this.runDir.path,
      MARKFLOW_WORKDIR: this.runDir.workdirPath,
      ...(this.options.workspaceDir ? { MARKFLOW_WORKSPACE: this.options.workspaceDir } : {}),
    };

    const prevResult = this.findPreviousResult(token.nodeId);
    if (prevResult) {
      env.MARKFLOW_PREV_STEP = prevResult.node;
      env.MARKFLOW_PREV_EDGE = prevResult.edge;
      env.MARKFLOW_PREV_SUMMARY = prevResult.summary;
    }

    // Cross-step reads: structured JSON for full access
    env.STEPS = JSON.stringify(this.buildStepsMap());

    // Self state (from prior invocation of this same step, on re-entry) and
    // workflow-wide globals, injected as JSON strings scripts can jq into.
    let selfPrior: StepResult | undefined;
    for (let i = this.completedResults.length - 1; i >= 0; i--) {
      if (this.completedResults[i].node === token.nodeId) {
        selfPrior = this.completedResults[i];
        break;
      }
    }
    env.LOCAL = JSON.stringify(selfPrior?.local ?? {});
    env.GLOBAL = JSON.stringify(this.globalContext);

    // Get outgoing edge labels for agent prompt
    const outgoing = getOutgoingEdges(this.def.graph, token.nodeId);
    const edgeLabels = outgoing
      .filter((e) => e.label && !e.annotations.isExhaustionHandler)
      .map((e) => e.label!);

    // Increment per-node call count (1-indexed) and invoke beforeStep hook
    const callCount = (this.nodeCalls.get(token.nodeId) ?? 0) + 1;
    this.nodeCalls.set(token.nodeId, callCount);

    const retryBudgets: BeforeStepContext["retryBudgets"] = [];
    const nodeRetries = this.retryState.counters.get(token.nodeId);
    for (const edge of outgoing) {
      if (edge.annotations.maxRetries !== undefined && edge.label) {
        retryBudgets.push({
          label: edge.label,
          count: nodeRetries?.get(edge.label) ?? 0,
          max: edge.annotations.maxRetries,
        });
      }
    }

    let mockDirective: { edge: string; summary?: string; exitCode?: number; local?: Record<string, unknown>; global?: Record<string, unknown> } | undefined;
    if (this.options.beforeStep) {
      const ctx: BeforeStepContext = {
        nodeId: token.nodeId,
        step,
        callCount,
        env,
        resolvedInputs: this.resolvedInputs,
        outgoingEdges: outgoing,
        retryBudgets,
        completedResults: this.completedResults,
        globalContext: { ...this.globalContext },
        prompt:
          step.type === "agent"
            ? assembleAgentPrompt(
                step,
                this.completedResults,
                edgeLabels,
                this.runDir.workdirPath,
                env,
                this.globalContext,
              )
            : undefined,
      };
      const directive = await this.options.beforeStep(ctx);
      if (directive) {
        mockDirective = directive;
      }
    }

    // Either synthesize a StepOutput from the mock directive, or run the step
    let output: StepOutput;
    if (mockDirective) {
      const defaultExit =
        step.type === "script" ? (mockDirective.edge === "fail" ? 1 : 0) : 0;
      output = {
        exitCode: mockDirective.exitCode ?? defaultExit,
        stdout: "",
        stderr: "",
        parsedResult: {
          edge: mockDirective.edge,
          summary: mockDirective.summary ?? "",
          local: mockDirective.local,
          global: mockDirective.global,
        },
      };
    } else {
      output = await runStep(
        step,
        this.completedResults,
        edgeLabels,
        this.runDir.workdirPath,
        env,
        this.runDir.path,
        this.config,
        this.globalContext,
        (stream, chunk) =>
          this.emit({ type: "step:output", nodeId: token.nodeId, stream, chunk }),
      );
    }

    // Build StepResult
    const completedAt = new Date().toISOString();
    let edge: string;
    let summary: string;

    if (output.parsedResult?.edge) {
      edge = output.parsedResult.edge;
      summary = output.parsedResult.summary ?? "";
    } else {
      // No explicit edge → unified default: exit 0 → "next", otherwise "fail".
      // Applies equally to script and agent steps (agent execution errors such
      // as CLI-not-found or stream parse errors force a non-zero exit code in
      // runner/agent.ts, so they land on "fail" here).
      edge = output.exitCode === 0 ? "next" : "fail";
      summary = step.type === "script" ? output.stdout.slice(0, 500).trim() : output.parsedResult?.summary ?? "";
    }

    const result: StepResult = {
      node: token.nodeId,
      type: step.type,
      edge,
      summary,
      local: output.parsedResult?.local,
      started_at: startedAt,
      completed_at: completedAt,
      exit_code:
        step.type === "script"
          ? output.exitCode
          : mockDirective?.exitCode ?? null,
    };

    if (output.parsedResult?.global) {
      Object.assign(this.globalContext, output.parsedResult.global);
    }

    token.state = "complete";
    token.edge = edge;
    token.result = result;

    this.completedResults.push(result);
    await this.runDir.logger.append(result);
    this.resolvedNodes.add(token.nodeId);

    this.emit({ type: "step:complete", nodeId: token.nodeId, result });

    // Route to next node(s)
    await this.routeFrom(token, result);
  }

  private async routeFrom(token: Token, result: StepResult): Promise<void> {
    const outgoing = getOutgoingEdges(this.def.graph, token.nodeId);
    if (outgoing.length === 0) return; // terminal node

    const decision = resolveRoute(
      this.def.graph,
      token.nodeId,
      result,
      this.retryState,
      this.config,
    );

    if (decision.retryIncrement) {
      this.emit({
        type: "retry:increment",
        nodeId: token.nodeId,
        label: decision.retryIncrement.label,
        count: decision.retryIncrement.count,
        max: decision.retryIncrement.max,
      });
    }

    if (decision.exhausted) {
      this.emit({
        type: "retry:exhausted",
        nodeId: token.nodeId,
        label: result.edge,
      });
    }

    for (const target of decision.targets) {
      this.emit({
        type: "route",
        from: token.nodeId,
        to: target.nodeId,
        edge: target.edge.label,
      });

      // Track merge node completions
      if (isMergeNode(this.def.graph, target.nodeId)) {
        if (!this.mergeCompletions.has(target.nodeId)) {
          this.mergeCompletions.set(target.nodeId, new Set());
        }
        this.mergeCompletions.get(target.nodeId)!.add(token.nodeId);
      }

      // Create token for target if it doesn't already have a pending one
      const existingPending = [...this.tokens.values()].find(
        (t) => t.nodeId === target.nodeId && t.state === "pending",
      );
      if (!existingPending) {
        this.createToken(target.nodeId);
      }
    }

    // Mark nodes that routed away from merge targets as skipped
    this.handleSkippedUpstreams();
  }

  private handleSkippedUpstreams(): void {
    // For each pending merge token, check if all upstream nodes are resolved
    // (either completed and routed here, or completed and routed elsewhere)
    for (const token of this.tokens.values()) {
      if (token.state !== "pending") continue;
      if (!isMergeNode(this.def.graph, token.nodeId)) continue;

      const upstreams = getUpstreamNodes(this.def.graph, token.nodeId);
      for (const upstream of upstreams) {
        // If upstream is resolved but hasn't routed to this merge node,
        // it's effectively skipped from this merge node's perspective
        if (this.resolvedNodes.has(upstream)) {
          // Already counted — the merge readiness check uses resolvedNodes
        }
      }
    }
  }

  private findPreviousResult(nodeId: string): StepResult | undefined {
    // Find the most recent result from a node that routed to this one
    const incoming = this.def.graph.edges.filter((e) => e.to === nodeId);
    for (let i = this.completedResults.length - 1; i >= 0; i--) {
      const r = this.completedResults[i];
      if (incoming.some((e) => e.from === r.node)) {
        return r;
      }
    }
    return undefined;
  }

  private async resolveInputs(): Promise<Record<string, string>> {
    const declared = this.def.inputs;
    const names = new Set(declared.map((d) => d.name));
    const resolved: Record<string, string> = {};

    const overlay = (source: Record<string, string>, onlyDeclared = true) => {
      for (const [k, v] of Object.entries(source)) {
        if (!onlyDeclared || names.has(k)) resolved[k] = v;
      }
    };

    // 1. Declared defaults (lowest priority)
    for (const decl of declared) {
      if (decl.default !== undefined) resolved[decl.name] = decl.default;
    }

    // 2. Global environment — only for declared input names
    overlay(process.env as Record<string, string>);

    // 3. Workspace .env (if workspaceDir provided)
    if (this.options.workspaceDir) {
      overlay(await loadEnvFile(join(this.options.workspaceDir, ".env")));
    }

    // 4. --env file (explicit path)
    if (this.options.envFile) {
      overlay(await loadEnvFile(this.options.envFile));
    }

    // 5. --input flags — highest priority, accept any key
    overlay(this.options.inputs ?? {}, false);

    // Validate required inputs are present
    const missing = declared
      .filter((d) => d.required && !(d.name in resolved))
      .map((d) => d.name);

    if (missing.length > 0) {
      throw new Error(
        `Missing required workflow inputs: ${missing.join(", ")}. ` +
          `Set them in the environment, a .env file, or pass with --input KEY=VALUE`,
      );
    }

    return resolved;
  }

  private buildStepsMap(): Record<string, { edge: string; summary: string; local?: Record<string, unknown> }> {
    const map: Record<string, { edge: string; summary: string; local?: Record<string, unknown> }> = {};
    for (const r of this.completedResults) {
      map[r.node] = { edge: r.edge, summary: r.summary, local: r.local };
    }
    return map;
  }

  private createToken(nodeId: string): Token {
    const id = `token-${++this.tokenCounter}`;
    const token: Token = {
      id,
      nodeId,
      generation: 0,
      state: "pending",
    };
    this.tokens.set(id, token);
    return token;
  }

  private emit(event: Parameters<EngineEventHandler>[0]): void {
    this.options.onEvent?.(event);
  }
}
