import type {
  WorkflowDefinition,
  MarkflowConfig,
  EngineEventHandler,
  Token,
  StepResult,
  RunInfo,
  FlowEdge,
} from "./types.js";
import { getOutgoingEdges, getStartNodes, getUpstreamNodes, isMergeNode } from "./graph.js";
import { resolveRoute, createRetryState, type RetryState } from "./router.js";
import { runStep } from "./runner/index.js";
import { createRunManager, type RunDirectory } from "./run-manager.js";
import { loadConfig, DEFAULT_CONFIG } from "./config.js";

export interface EngineOptions {
  config?: Partial<MarkflowConfig>;
  runsDir?: string;
  onEvent?: EngineEventHandler;
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
  private tokenCounter = 0;

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
      WORKFLOW_RUN_DIR: this.runDir.path,
      WORKFLOW_WORKSPACE: this.runDir.workspacePath,
    };

    // Find the last result that routed to this node for PREV_ vars
    const prevResult = this.findPreviousResult(token.nodeId);
    if (prevResult) {
      env.PREV_NODE = prevResult.node;
      env.PREV_EDGE = prevResult.edge;
      env.PREV_SUMMARY = prevResult.summary;
    }

    // Get outgoing edge labels for agent prompt
    const outgoing = getOutgoingEdges(this.def.graph, token.nodeId);
    const edgeLabels = outgoing
      .filter((e) => e.label && !e.annotations.isExhaustionHandler)
      .map((e) => e.label!);

    const output = await runStep(
      step,
      this.completedResults,
      edgeLabels,
      this.runDir.workspacePath,
      env,
      this.runDir.path,
      this.config,
    );

    // Build StepResult
    const completedAt = new Date().toISOString();
    let edge: string;
    let summary: string;

    if (output.parsedResult?.edge) {
      edge = output.parsedResult.edge;
      summary = output.parsedResult.summary ?? "";
    } else if (step.type === "script") {
      // Derive edge from exit code — will be resolved by router
      edge = output.exitCode === 0 ? "pass" : "fail";
      summary = output.stdout.slice(0, 500).trim();
    } else {
      edge = "done";
      summary = "";
    }

    const result: StepResult = {
      node: token.nodeId,
      type: step.type,
      edge,
      summary,
      started_at: startedAt,
      completed_at: completedAt,
      exit_code: step.type === "script" ? output.exitCode : null,
    };

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
