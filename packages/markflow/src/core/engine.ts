import { safeMerge } from "./safe-merge.js";
import type {
  WorkflowDefinition,
  MarkflowConfig,
  EngineEvent,
  EngineEventHandler,
  EngineEventPayload,
  EngineSnapshot,
  Token,
  TokenState,
  StepDefinition,
  StepResult,
  RunInfo,
  RunStatus,
  BeforeStepHook,
  BeforeStepContext,
  StepOutput,
} from "./types.js";
import {
  getOutgoingEdges,
  getStartNodes,
  getUpstreamNodes,
  isMergeNode,
  getForEachScope,
  findForEachSource,
} from "./graph.js";
import {
  resolveRoute,
  createRetryState,
  effectiveMaxRetries,
  incrementRetry,
  type RetryState,
} from "./router.js";
import { runStep } from "./runner/index.js";
import { assembleAgentPrompt } from "./runner/agent.js";
import {
  createRunManager,
  type ResumeHandle,
  type RunDirectory,
} from "./run-manager.js";
import { loadConfig, DEFAULT_CONFIG } from "./config.js";
import { loadEnvFile } from "./env.js";
import { parseDuration } from "./duration.js";
import { computeRetryDelay, abortableSleep } from "./retry.js";
import { ExecutionError, ConfigError, WorkflowChangedError } from "./errors.js";
import { join, dirname } from "node:path";
import { access, mkdir } from "node:fs/promises";

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
  /** AbortSignal for graceful cancellation (e.g. SIGINT). */
  signal?: AbortSignal;
  /**
   * Resume a prior run obtained via `RunManager.openExistingRun`. When set,
   * `start()` skips fresh-run setup (no `createRun`, no start-node seeding)
   * and instead restores snapshot state, emits a `run:resumed` marker, and
   * dispatches any pending tokens.
   */
  resumeFrom?: ResumeHandle;
  /**
   * Decide a pending approval on a single node. The engine consumes the
   * decision when it dispatches a waiting token at `nodeId`, emits
   * `approval:decided`, synthesises a `StepResult` with `edge = choice`, and
   * routes as if a script had selected that edge. A second waiting token on
   * the same node is not auto-decided — call the engine again.
   */
  approvalDecision?: { nodeId: string; choice: string; decidedBy?: string };
}

/**
 * Reconstruct a RetryState from a snapshot's `retryBudgets` map. Keys are
 * `${nodeId}:${label}` — split them back into the nested counter shape the
 * router expects.
 */
function rebuildRetryState(snap: EngineSnapshot): RetryState {
  const state = createRetryState();
  for (const [key, budget] of snap.retryBudgets) {
    // Per-item keys: "batchId:itemIndex:nodeId:label" — skip those here.
    const parts = key.split(":");
    if (parts.length > 2) continue;
    const idx = key.lastIndexOf(":");
    if (idx <= 0) continue;
    const nodeId = key.slice(0, idx);
    const label = key.slice(idx + 1);
    let perNode = state.counters.get(nodeId);
    if (!perNode) {
      perNode = new Map();
      state.counters.set(nodeId, perNode);
    }
    perNode.set(label, budget.count);
  }
  return state;
}

function rebuildBatchItemRetryStates(
  snap: EngineSnapshot,
): Map<string, RetryState> {
  const map = new Map<string, RetryState>();
  for (const [key, budget] of snap.retryBudgets) {
    // Per-item keys: "batchId:itemIndex:nodeId:label"
    const parts = key.split(":");
    if (parts.length <= 2) continue;
    // Extract: batchId is "batch-N", itemIndex, nodeId, label
    const match = key.match(/^(batch-\d+):(\d+):(.+):([^:]+)$/);
    if (!match) continue;
    const [, batchId, itemIndexStr, nodeId, label] = match;
    const itemKey = `${batchId}:${itemIndexStr}`;
    if (!map.has(itemKey)) map.set(itemKey, createRetryState());
    const state = map.get(itemKey)!;
    if (!state.counters.has(nodeId)) state.counters.set(nodeId, new Map());
    state.counters.get(nodeId)!.set(label, budget.count);
  }
  return map;
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
  private status: RunStatus = "running";

  /** Per-node execution counts (nodeId → count). */
  private nodeCalls: Map<string, number> = new Map();

  /** Track which upstream nodes have completed for each merge node */
  private mergeCompletions: Map<string, Set<string>> = new Map();

  /** Track which upstream nodes have resolved (completed or skipped) */
  private resolvedNodes: Set<string> = new Set();

  /** Active forEach batches (batchId → state). */
  private batches: Map<string, import("./types.js").BatchState> = new Map();

  /** Per-item retry state: "batchId:itemIndex" → RetryState. */
  private batchItemRetryStates: Map<string, RetryState> = new Map();

  constructor(definition: WorkflowDefinition, options: EngineOptions = {}) {
    this.def = definition;
    this.options = options;
  }

  async start(): Promise<RunInfo> {
    // Load config
    const fileConfig = await loadConfig(this.def.sourceFile);
    this.config = {
      ...DEFAULT_CONFIG,
      ...(this.def.configDefaults ?? {}),
      ...fileConfig,
      ...this.options.config,
    } as MarkflowConfig;

    if (this.def.configDefaults) {
      const jsonPath = join(dirname(this.def.sourceFile), ".workflow.json");
      try {
        await access(jsonPath);
        console.warn(
          `markflow: both a top-level \`\`\`config block and ${jsonPath} are present — .workflow.json values win.`,
        );
      } catch {
        // no sidecar — no conflict
      }
    }

    // Resolve workflow inputs through the layered source stack
    this.resolvedInputs = await this.resolveInputs();

    const resume = this.options.resumeFrom;
    const runManager = createRunManager(this.options.runsDir);

    if (resume) {
      // Reject workflows whose node set no longer contains a replayed token's
      // nodeId. Deeper semantic drift (changed step bodies) is out of scope.
      const missing = new Set<string>();
      for (const tok of resume.snapshot.tokens.values()) {
        if (!this.def.graph.nodes.has(tok.nodeId)) missing.add(tok.nodeId);
      }
      if (missing.size > 0) {
        throw new WorkflowChangedError([...missing]);
      }

      this.runDir = resume.runDir;
      this.tokenCounter = resume.tokenCounter;
      this.restoreFromSnapshot(resume.snapshot);
      this.retryState = rebuildRetryState(resume.snapshot);

      // First new event on the appended log — makes "resumed at seq N"
      // directly observable via `markflow show --events`.
      await this.emit({
        type: "run:resumed",
        v: 1,
        resumedAtSeq: resume.lastSeq,
      });

      await this.resumeIncompleteBatches();
    } else {
      // Create run directory
      this.runDir = await runManager.createRun(this.def);

      const SECRET_RE = /KEY|TOKEN|SECRET|PASSWORD/i;
      const safeInputs = Object.fromEntries(
        Object.entries(this.resolvedInputs).map(([k, v]) =>
          [k, SECRET_RE.test(k) ? "***" : v]
        )
      );

      await this.emit({
        type: "run:start",
        v: 1,
        runId: this.runDir.id,
        workflowName: this.def.name,
        sourceFile: this.def.sourceFile,
        inputs: safeInputs,
        configResolved: this.config,
      });

      this.retryState = createRetryState();
    }

    try {
      try {
        if (!resume) {
          // Find start nodes and create initial tokens
          const startNodes = getStartNodes(this.def.graph);
          if (startNodes.length === 0) {
            throw new ExecutionError("Workflow has no start nodes (no nodes without incoming edges)");
          }

          for (const nodeId of startNodes) {
            await this.createToken(nodeId);
          }
        }

        // Main execution loop
        await this.runLoop();

        // Suspended (at least one token in `waiting` state) — clean exit without
        // `workflow:complete`. Persisted status goes to "suspended" so `ls`/`show`
        // and the CLI exit-code contract distinguish it from "complete"/"error".
        const hasWaiting = [...this.tokens.values()].some(
          (t) => t.state === "waiting",
        );
        if (hasWaiting) {
          await runManager.completeRun(this.runDir.id, "suspended");
          this.status = "suspended";
          return {
            id: this.runDir.id,
            workflowName: this.def.name,
            sourceFile: this.def.sourceFile,
            status: "suspended",
            startedAt: this.runDir.id,
            steps: this.completedResults,
          };
        }

        // Complete
        await runManager.completeRun(this.runDir.id, "complete");
        this.status = "complete";
        await this.emit({
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
        this.status = "error";
        await this.emit({ type: "workflow:error", error: message });

        return {
          id: this.runDir.id,
          workflowName: this.def.name,
          sourceFile: this.def.sourceFile,
          status: "error",
          startedAt: this.runDir.id,
          steps: this.completedResults,
        };
      }
    } finally {
      // Exactly one release per `openExistingRun` — terminal status,
      // suspend, workflow:error, and unexpected throws all land here.
      // Swallow release errors so the primary result/throw propagates.
      if (resume) {
        await resume.release().catch(() => {});
      }
    }
  }

  private async runLoop(): Promise<void> {
    while (true) {
      if (this.options.signal?.aborted) {
        throw new ExecutionError("Workflow interrupted");
      }

      const readyTokens = this.getReadyTokens();
      if (readyTokens.length === 0) {
        // Waiting tokens (approval nodes pending a decision) are a clean-exit
        // condition — suspend, don't deadlock.
        const waiting = [...this.tokens.values()].filter(
          (t) => t.state === "waiting",
        );
        if (waiting.length > 0) break;

        // Check if there are still pending tokens (waiting for merge)
        const pending = [...this.tokens.values()].filter(
          (t) => t.state === "pending",
        );
        if (pending.length > 0) {
          // Batch tokens at merge nodes may be waiting for sibling branch
          // tokens from the same item — that's not a deadlock if there are
          // running tokens that will eventually contribute.
          const hasRunning = [...this.tokens.values()].some(
            (t) => t.state === "running",
          );
          if (!hasRunning) {
            throw new ExecutionError(
              `Deadlock: ${pending.length} pending tokens but none are ready. ` +
              `Nodes: ${pending.map((t) => t.nodeId).join(", ")}`,
            );
          }
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
    const decision = this.options.approvalDecision;

    for (const token of this.tokens.values()) {
      // A waiting token is ready only if the caller supplied a matching
      // approvalDecision for this invocation. Otherwise it stays suspended.
      if (token.state === "waiting") {
        if (decision && decision.nodeId === token.nodeId) {
          ready.push(token);
        }
        continue;
      }

      if (token.state !== "pending") continue;

      if (isMergeNode(this.def.graph, token.nodeId)) {
        if (token.batchId != null) {
          // Per-item merge inside forEach: ready when no sibling batch token
          // for the same item is still running at an upstream node.
          const upstreams = getUpstreamNodes(this.def.graph, token.nodeId);
          const hasRunningUpstream = [...this.tokens.values()].some(
            (t) =>
              t.batchId === token.batchId &&
              t.itemIndex === token.itemIndex &&
              t.id !== token.id &&
              (t.state === "running" || t.state === "pending") &&
              upstreams.includes(t.nodeId),
          );
          if (!hasRunningUpstream) ready.push(token);
        } else {
          // Global merge: all upstream nodes must be resolved
          const upstreams = getUpstreamNodes(this.def.graph, token.nodeId);
          const allResolved = upstreams.every((u) => this.resolvedNodes.has(u));
          if (allResolved) {
            ready.push(token);
          }
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
      throw new ExecutionError(`No step definition for node "${token.nodeId}"`);
    }

    // Approval nodes branch before the pending→running transition. `getReadyTokens`
    // only surfaces `pending` tokens, so a `waiting` token dispatches here only
    // when resumed with a matching `approvalDecision`.
    if (step.type === "approval") {
      await this.executeApproval(token, step.approvalConfig);
      return;
    }

    await this.record(
      { type: "token:state", tokenId: token.id, from: "pending", to: "running" },
      () => {
        token.state = "running";
      },
    );
    const startEvent = await this.emit({
      type: "step:start",
      nodeId: token.nodeId,
      tokenId: token.id,
    });

    // Sidecar transcript files are keyed by the `step:start` seq (not the
    // tokenId — a token traverses multiple nodes, and loops re-visit the same
    // node; seq is the only identifier that uniquely names a single step
    // execution). Emit `output:ref` events *before* opening the streams so
    // that a crash mid-step still leaves a log record pointing at the file.
    const outputDir = join(this.runDir.path, "output");
    await mkdir(outputDir, { recursive: true });
    const seqStr = String(startEvent.seq).padStart(4, "0");
    const stdoutPath = join(outputDir, `${seqStr}-${token.nodeId}.stdout.log`);
    const stderrPath = join(outputDir, `${seqStr}-${token.nodeId}.stderr.log`);
    await this.emit({
      type: "output:ref",
      stepSeq: startEvent.seq,
      tokenId: token.id,
      nodeId: token.nodeId,
      stream: "stdout",
      path: stdoutPath,
    });
    await this.emit({
      type: "output:ref",
      stepSeq: startEvent.seq,
      tokenId: token.id,
      nodeId: token.nodeId,
      stream: "stderr",
      path: stderrPath,
    });
    const sidecar = { stdoutPath, stderrPath };

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

    if (token.batchId != null) {
      env.ITEM = JSON.stringify(token.itemContext ?? null);
      env.ITEM_INDEX = String(token.itemIndex ?? 0);
    }

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
      const max = effectiveMaxRetries(edge, this.def.graph, token.nodeId, this.config);
      if (max !== undefined && edge.label) {
        retryBudgets.push({
          label: edge.label,
          count: nodeRetries?.get(edge.label) ?? 0,
          max,
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

    // Either synthesize a StepOutput from the mock directive, or run the step.
    // Step-level retry (stepConfig.retry) wraps the real-execution path: on
    // failure, sleep per the backoff and re-run in place. Mock directives
    // bypass retry — the test harness controls attempts via callCount.
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
      const retryPolicy = step.stepConfig?.retry;
      let retryAttempt = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const limitStr = step.stepConfig?.timeout ?? this.config.timeoutDefault;
        const limitMs = limitStr ? parseDuration(limitStr) : undefined;
        const startMs = Date.now();

        const timeoutSignal = limitMs !== undefined ? AbortSignal.timeout(limitMs) : undefined;
        const signals = [this.options.signal, timeoutSignal].filter(
          (s): s is AbortSignal => s !== undefined,
        );
        const composed =
          signals.length === 0
            ? undefined
            : signals.length === 1
              ? signals[0]
              : AbortSignal.any(signals);

        output = await runStep(
          step,
          this.completedResults,
          edgeLabels,
          this.runDir.workdirPath,
          env,
          this.runDir.path,
          this.config,
          this.globalContext,
          (stream, chunk) => {
            // step:output is non-persisted; fire-and-forget is fine — the
            // logger still assigns a monotonic seq synchronously.
            void this.emit({
              type: "step:output",
              nodeId: token.nodeId,
              stream,
              chunk,
            });
          },
          composed,
          sidecar,
        );

        let timedOut = false;
        // Distinguish our timeout from a user abort: only the timeoutSignal
        // should have fired. If both fire (user aborted just as timeout hit),
        // prefer user-abort semantics and skip the timeout event.
        if (
          timeoutSignal?.aborted &&
          !this.options.signal?.aborted &&
          limitMs !== undefined
        ) {
          const elapsedMs = Date.now() - startMs;
          await this.emit({
            type: "step:timeout",
            nodeId: token.nodeId,
            tokenId: token.id,
            elapsedMs,
            limitMs,
          });
          output = {
            exitCode: 124,
            stdout: output.stdout,
            stderr:
              (output.stderr && !output.stderr.endsWith("\n") ? output.stderr + "\n" : output.stderr) +
              `[markflow] step "${token.nodeId}" timed out after ${limitStr}\n`,
            parsedResult: {
              edge: "fail",
              summary: `timeout after ${limitStr}`,
            },
          };
          timedOut = true;
        }

        const attemptEdge =
          output.parsedResult?.edge ?? (output.exitCode === 0 ? "next" : "fail");
        const failed = attemptEdge === "fail";

        if (!failed || !retryPolicy || retryAttempt >= retryPolicy.max) break;

        const delayMs = computeRetryDelay(retryPolicy, retryAttempt);
        await this.emit({
          type: "step:retry",
          nodeId: token.nodeId,
          tokenId: token.id,
          attempt: retryAttempt + 1,
          delayMs,
          reason: timedOut ? "timeout" : "fail",
        });
        await abortableSleep(delayMs, this.options.signal);
        retryAttempt++;
      }
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

    // Preserve the original ordering: global context update, then token state
    // transition, then step:complete. Replay reconstructs the same interleaving.
    if (output.parsedResult?.global && Object.keys(output.parsedResult.global).length > 0) {
      const patch = output.parsedResult.global;
      await this.record(
        {
          type: "global:update",
          keys: Object.keys(patch),
          patch,
        },
        () => {
          safeMerge(this.globalContext, patch);
        },
      );
    }

    await this.record(
      { type: "token:state", tokenId: token.id, from: "running", to: "complete" },
      () => {
        token.state = "complete";
        token.edge = edge;
        token.result = result;
      },
    );

    await this.record(
      { type: "step:complete", nodeId: token.nodeId, tokenId: token.id, result },
      () => {
        this.completedResults.push(result);
        this.resolvedNodes.add(token.nodeId);
      },
    );

    // Route to next node(s)
    await this.routeFrom(token, result);
  }

  private async executeApproval(
    token: Token,
    cfg: StepDefinition["approvalConfig"],
  ): Promise<void> {
    if (!cfg) {
      throw new ExecutionError(
        `Approval step "${token.nodeId}" has no approvalConfig`,
      );
    }

    const decision = this.options.approvalDecision;
    const matches = decision && decision.nodeId === token.nodeId;

    if (!matches) {
      // Case A — no decision for this token. Transition pending→waiting and
      // emit step:waiting. The runLoop observes no ready tokens and exits.
      await this.record(
        { type: "token:state", tokenId: token.id, from: token.state, to: "waiting" },
        () => {
          token.state = "waiting";
        },
      );
      await this.emit({
        type: "step:waiting",
        v: 1,
        nodeId: token.nodeId,
        tokenId: token.id,
        prompt: cfg.prompt,
        options: [...cfg.options],
      });
      return;
    }

    // Case B — decision matches this token's node.
    const choice = decision!.choice;
    if (!cfg.options.includes(choice)) {
      throw new ExecutionError(
        `Approval choice "${choice}" is not valid for node "${token.nodeId}". ` +
          `Options: ${cfg.options.join(", ")}`,
      );
    }

    // Consume the decision so a second waiting token on the same node is not
    // auto-decided within the same invocation.
    this.options = { ...this.options, approvalDecision: undefined };

    const fromState: TokenState = token.state === "waiting" ? "waiting" : "pending";
    await this.record(
      { type: "token:state", tokenId: token.id, from: fromState, to: "running" },
      () => {
        token.state = "running";
      },
    );

    const startedAt = new Date().toISOString();
    await this.emit({
      type: "approval:decided",
      v: 1,
      nodeId: token.nodeId,
      tokenId: token.id,
      choice,
      decidedAt: startedAt,
      decidedBy: decision!.decidedBy,
    });

    const completedAt = new Date().toISOString();
    const result: StepResult = {
      node: token.nodeId,
      type: "approval",
      edge: choice,
      summary: `approved: ${choice}`,
      started_at: startedAt,
      completed_at: completedAt,
      exit_code: null,
    };

    await this.record(
      { type: "token:state", tokenId: token.id, from: "running", to: "complete" },
      () => {
        token.state = "complete";
        token.edge = choice;
        token.result = result;
      },
    );

    await this.record(
      { type: "step:complete", nodeId: token.nodeId, tokenId: token.id, result },
      () => {
        this.completedResults.push(result);
        this.resolvedNodes.add(token.nodeId);
      },
    );

    await this.routeFrom(token, result);
  }

  private async routeFrom(token: Token, result: StepResult): Promise<void> {
    const outgoing = getOutgoingEdges(this.def.graph, token.nodeId);
    if (outgoing.length === 0) {
      // Terminal node — if this is a batch token at the last body node,
      // complete the batch item and potentially the entire batch.
      if (token.batchId) {
        await this.completeBatchItem(token);
      }
      return;
    }

    // forEach fan-out: if the outgoing edge is a thick `each:` edge,
    // spawn N batch tokens instead of normal routing.
    const forEachEdge = outgoing.find(
      (e) => e.stroke === "thick" && e.annotations.forEach,
    );
    if (forEachEdge) {
      await this.spawnBatch(token, result, forEachEdge);
      return;
    }

    // Batch token routing within the forEach scope: use resolveRoute()
    // for conditional branching, retries, and fan-out within the scope.
    if (token.batchId) {
      const scopeInfo = findForEachSource(this.def.graph, token.nodeId);
      if (!scopeInfo) {
        await this.completeBatchItem(token);
        return;
      }
      const { scope } = scopeInfo;

      const itemKey = `${token.batchId}:${token.itemIndex}`;
      if (!this.batchItemRetryStates.has(itemKey)) {
        this.batchItemRetryStates.set(itemKey, createRetryState());
      }
      const itemRetryState = this.batchItemRetryStates.get(itemKey)!;

      const decision = resolveRoute(
        this.def.graph,
        token.nodeId,
        result,
        itemRetryState,
        this.config,
      );

      if (decision.retryIncrement) {
        const inc = decision.retryIncrement;
        await this.record(
          {
            type: "retry:increment",
            nodeId: token.nodeId,
            label: inc.label,
            count: inc.count,
            max: inc.max,
            batchId: token.batchId,
            itemIndex: token.itemIndex,
          },
          () => {
            incrementRetry(itemRetryState, token.nodeId, inc.label);
          },
        );
      }

      if (decision.exhausted) {
        await this.emit({
          type: "retry:exhausted",
          nodeId: token.nodeId,
          label: result.edge,
        });
      }

      for (const target of decision.targets) {
        if (scope.bodyNodes.has(target.nodeId)) {
          // Target is inside scope — route within forEach body
          await this.emit({
            type: "route",
            from: token.nodeId,
            to: target.nodeId,
            edge: target.edge.label,
            batchId: token.batchId,
            itemIndex: token.itemIndex,
          });

          // For merge nodes: deduplicate — only create one token per item.
          // Additional routes just contribute to readiness.
          if (isMergeNode(this.def.graph, target.nodeId)) {
            const existingMergeToken = [...this.tokens.values()].find(
              (t) =>
                t.batchId === token.batchId &&
                t.itemIndex === token.itemIndex &&
                t.nodeId === target.nodeId &&
                t.state === "pending",
            );
            if (existingMergeToken) continue;
          }

          await this.createBatchToken(
            target.nodeId,
            token.batchId,
            token.itemIndex!,
            token.parentTokenId!,
            token.itemContext,
          );
        } else {
          // Target is outside scope (collector) — complete batch item
          await this.completeBatchItem(token);
        }
      }
      return;
    }

    const decision = resolveRoute(
      this.def.graph,
      token.nodeId,
      result,
      this.retryState,
      this.config,
    );

    if (decision.retryIncrement) {
      const inc = decision.retryIncrement;
      await this.record(
        {
          type: "retry:increment",
          nodeId: token.nodeId,
          label: inc.label,
          count: inc.count,
          max: inc.max,
        },
        () => {
          incrementRetry(this.retryState, token.nodeId, inc.label);
        },
      );
    }

    if (decision.exhausted) {
      await this.emit({
        type: "retry:exhausted",
        nodeId: token.nodeId,
        label: result.edge,
      });
    }

    for (const target of decision.targets) {
      await this.emit({
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
        await this.createToken(target.nodeId);
      }
    }

    // Mark nodes that routed away from merge targets as skipped
    this.handleSkippedUpstreams();
  }

  /**
   * On resume, walk incomplete batches and re-spawn tokens for items that
   * never finished. Reuses the original `batchId` and pulls `itemContext`
   * from the per-batch list captured at `batch:start` time, so the source
   * step's `LOCAL` does not need to be re-evaluated. Mid-flight tokens left
   * in the `running` state are reset to `pending` so the run loop will
   * re-dispatch them.
   */
  private async resumeIncompleteBatches(): Promise<void> {
    for (const [batchId, batch] of this.batches) {
      if (batch.done) continue;

      // If fail-fast already triggered, don't spawn new items — let in-flight drain.
      const failFastAborted =
        batch.onItemError === "fail-fast" && batch.failed > 0;

      const completedIndices = new Set<number>();
      const liveTokensByIndex = new Map<number, Token>();
      for (const tok of this.tokens.values()) {
        if (tok.batchId !== batchId || tok.itemIndex == null) continue;
        if (tok.state === "complete" || tok.state === "skipped") {
          completedIndices.add(tok.itemIndex);
        } else {
          liveTokensByIndex.set(tok.itemIndex, tok);
        }
      }
      // Batch-item events may have been recorded without a terminal
      // token:state — treat any `batch:item:complete` as authoritative too.
      for (let i = 0; i < batch.results.length; i++) {
        if (batch.results[i] != null) completedIndices.add(i);
      }

      const scope = getForEachScope(this.def.graph, batch.nodeId);
      if (!scope) continue;
      const firstBodyNode = scope.entryNode;

      // Respect maxConcurrency on resume: only spawn up to the window limit.
      const inFlight = liveTokensByIndex.size;
      const spawnLimit =
        batch.maxConcurrency > 0
          ? Math.max(0, batch.maxConcurrency - inFlight)
          : batch.expected;
      let spawned = 0;

      for (let i = 0; i < batch.expected; i++) {
        if (completedIndices.has(i)) continue;

        const existing = liveTokensByIndex.get(i);
        if (existing) {
          if (existing.state === "running") {
            await this.record(
              { type: "token:reset", v: 1, tokenId: existing.id },
              () => {
                existing.state = "pending";
                delete existing.edge;
                delete existing.result;
              },
            );
          }
          continue;
        }

        // Don't spawn if fail-fast aborted or concurrency window is full.
        if (failFastAborted || spawned >= spawnLimit) continue;

        await this.createBatchToken(
          firstBodyNode,
          batchId,
          i,
          `batch-source:${batch.nodeId}`,
          batch.itemContexts[i],
        );
        batch.spawned = Math.max(batch.spawned, i + 1);
        spawned++;
      }
    }
  }

  private async spawnBatch(
    sourceToken: Token,
    result: StepResult,
    forEachEdge: import("./types.js").FlowEdge,
  ): Promise<void> {
    const key = forEachEdge.annotations.forEach!.key;
    const local = result.local ?? {};
    const items = local[key];

    if (!Array.isArray(items)) {
      throw new ExecutionError(
        `forEach: LOCAL.${key} is not an array (got ${typeof items}) at node "${sourceToken.nodeId}"`,
      );
    }

    if (items.length === 0) {
      // Empty array — skip to collector.
      const scope = getForEachScope(this.def.graph, sourceToken.nodeId);
      if (scope) {
        this.resolvedNodes.add(sourceToken.nodeId);
        await this.createToken(scope.collectorNode);
      }
      return;
    }

    const sourceStep = this.def.steps.get(sourceToken.nodeId);
    const onItemError: import("./types.js").ForEachItemErrorMode =
      sourceStep?.stepConfig?.foreach?.onItemError ?? "fail-fast";
    const maxConcurrency = sourceStep?.stepConfig?.foreach?.maxConcurrency ?? 0;

    const batchId = `batch-${++this.tokenCounter}`;
    const initialSpawn =
      maxConcurrency > 0 ? Math.min(maxConcurrency, items.length) : items.length;

    await this.emit({
      type: "batch:start",
      v: 2,
      batchId,
      nodeId: sourceToken.nodeId,
      items: items.length,
      itemContexts: [...items],
      onItemError,
      maxConcurrency,
    });
    this.batches.set(batchId, {
      nodeId: sourceToken.nodeId,
      expected: items.length,
      completed: 0,
      succeeded: 0,
      failed: 0,
      onItemError,
      maxConcurrency,
      spawned: initialSpawn,
      itemContexts: [...items],
      results: new Array(items.length),
      done: false,
    });

    for (let i = 0; i < initialSpawn; i++) {
      await this.createBatchToken(
        forEachEdge.to,
        batchId,
        i,
        sourceToken.id,
        items[i],
      );
    }
  }

  private async completeBatchItem(token: Token): Promise<void> {
    const batchId = token.batchId!;
    const batch = this.batches.get(batchId);
    if (!batch) return;

    const itemIndex = token.itemIndex!;
    const edge = token.result?.edge ?? "fail";
    const ok = edge !== "fail";

    await this.emit({
      type: "batch:item:complete",
      v: 2,
      batchId,
      itemIndex,
      tokenId: token.id,
      ok,
      edge,
    });
    batch.completed++;
    if (ok) batch.succeeded++;
    else batch.failed++;
    batch.results[itemIndex] = {
      itemIndex,
      ok,
      edge,
      summary: token.result?.summary,
      local: token.result?.local,
    };

    // Sliding window refill: spawn the next pending item if there is capacity.
    const failFastAborted =
      batch.onItemError === "fail-fast" && batch.failed > 0;
    if (
      !failFastAborted &&
      batch.maxConcurrency > 0 &&
      batch.spawned < batch.expected
    ) {
      const scope = getForEachScope(this.def.graph, batch.nodeId);
      if (scope) {
        const nextIndex = batch.spawned;
        batch.spawned++;
        await this.createBatchToken(
          scope.entryNode,
          batchId,
          nextIndex,
          token.parentTokenId ?? `batch-source:${batch.nodeId}`,
          batch.itemContexts[nextIndex],
        );
      }
    }

    // Batch is done when all items completed, or fail-fast triggered and all
    // spawned items have drained.
    const batchDone =
      batch.completed >= batch.expected ||
      (failFastAborted && batch.completed >= batch.spawned);

    if (batchDone) {
      const hadFailure = batch.failed > 0;
      const status: "ok" | "error" =
        batch.onItemError === "fail-fast" && hadFailure ? "error" : "ok";

      await this.emit({
        type: "batch:complete",
        v: 2,
        batchId,
        succeeded: batch.succeeded,
        failed: batch.failed,
        status,
      });
      batch.done = true;
      batch.status = status;

      // Results ordered by itemIndex (pre-allocated on batch:start).
      const batchResults = batch.results.map((r) => r ?? null);

      await this.record(
        {
          type: "global:update",
          keys: ["results"],
          patch: { results: batchResults },
        },
        () => {
          this.globalContext.results = batchResults;
        },
      );

      const scope = getForEachScope(this.def.graph, batch.nodeId);
      if (!scope) return;

      this.resolvedNodes.add(batch.nodeId);
      for (const bodyNode of scope.bodyNodes) {
        this.resolvedNodes.add(bodyNode);
      }

      if (status === "error") {
        // fail-fast: bypass the collector and route the source on its `fail` edge.
        await this.routeBatchFailure(batch.nodeId);
      } else {
        await this.createToken(scope.collectorNode);
      }
    }
  }

  /**
   * When a batch aborts under `fail-fast`, route the source node on its
   * outgoing `fail` edge (if one exists). Without an explicit `fail` edge the
   * workflow terminates at the source — the collector is deliberately skipped.
   */
  private async routeBatchFailure(sourceNodeId: string): Promise<void> {
    const outgoing = getOutgoingEdges(this.def.graph, sourceNodeId);
    const failEdge = outgoing.find(
      (e) => e.label === "fail" && !e.annotations.isExhaustionHandler,
    );
    if (!failEdge) return;

    await this.emit({
      type: "route",
      from: sourceNodeId,
      to: failEdge.to,
      edge: "fail",
    });
    const existingPending = [...this.tokens.values()].find(
      (t) => t.nodeId === failEdge.to && t.state === "pending",
    );
    if (!existingPending) {
      await this.createToken(failEdge.to);
    }
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
      throw new ConfigError(
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

  /**
   * Test-only: capture the engine's live state as an `EngineSnapshot`.
   * Round-trip tests assert `replay(events) deep-equals getSnapshot()` at
   * every `step:complete` checkpoint.
   */
  getSnapshot(): EngineSnapshot {
    const budgets = new Map<string, { count: number; max: number }>();
    for (const [nodeId, byLabel] of this.retryState.counters) {
      for (const [label, count] of byLabel) {
        const max = this.findMaxForEdge(nodeId, label);
        if (max !== undefined) {
          budgets.set(`${nodeId}:${label}`, { count, max });
        }
      }
    }
    return {
      tokens: new Map(
        [...this.tokens.entries()].map(([id, t]) => [id, { ...t }]),
      ),
      retryBudgets: budgets,
      globalContext: { ...this.globalContext },
      completedResults: this.completedResults.map((r) => ({ ...r })),
      status: this.status,
      batches: new Map(this.batches),
    };
  }

  private findMaxForEdge(nodeId: string, label: string): number | undefined {
    const edge = this.def.graph.edges.find(
      (e) => e.from === nodeId && e.label === label,
    );
    if (!edge) return undefined;
    return effectiveMaxRetries(edge, this.def.graph, nodeId, this.config);
  }

  /**
   * Load a replayed `EngineSnapshot` into the live engine's mutable state.
   * Clone maps/records so mutating engine state does not alias the snapshot.
   */
  private restoreFromSnapshot(snap: EngineSnapshot): void {
    this.tokens = new Map(
      [...snap.tokens.entries()].map(([id, t]) => [id, { ...t }]),
    );
    this.globalContext = { ...snap.globalContext };
    this.completedResults = snap.completedResults.map((r) => ({ ...r }));
    this.status = snap.status === "complete" ? "running" : snap.status;

    // Rebuild derived per-run bookkeeping from the snapshot.
    this.resolvedNodes = new Set();
    for (const tok of this.tokens.values()) {
      if (tok.state === "complete" || tok.state === "skipped") {
        this.resolvedNodes.add(tok.nodeId);
      }
    }
    this.nodeCalls = new Map();
    for (const r of this.completedResults) {
      this.nodeCalls.set(r.node, (this.nodeCalls.get(r.node) ?? 0) + 1);
    }
    // `mergeCompletions` is populated by `routeFrom`; the readiness check
    // reads `resolvedNodes`, so leaving it empty on resume is safe.
    this.mergeCompletions = new Map();
    this.batchItemRetryStates = rebuildBatchItemRetryStates(snap);
    this.batches = new Map(
      [...snap.batches.entries()].map(([id, b]) => [id, { ...b }]),
    );
  }

  private async createToken(nodeId: string): Promise<Token> {
    // Reserve the token synchronously so that parallel `routeFrom` callers
    // see the new pending token before they decide whether to create their
    // own. Write-ahead discipline is preserved at the run level: a crash
    // between `set` and `append` loses only this token, which the replay
    // correctly never sees (nothing else referenced it yet).
    const id = `token-${++this.tokenCounter}`;
    const token: Token = {
      id,
      nodeId,
      generation: 0,
      state: "pending",
    };
    this.tokens.set(id, token);
    await this.record(
      { type: "token:created", tokenId: id, nodeId, generation: 0 },
      () => {},
    );
    return token;
  }

  private async createBatchToken(
    nodeId: string,
    batchId: string,
    itemIndex: number,
    parentTokenId: string,
    itemContext: unknown,
  ): Promise<Token> {
    const id = `token-${++this.tokenCounter}`;
    const token: Token = {
      id,
      nodeId,
      generation: 0,
      state: "pending",
      batchId,
      itemIndex,
      parentTokenId,
      itemContext,
    };
    this.tokens.set(id, token);
    await this.record(
      {
        type: "token:created",
        tokenId: id,
        nodeId,
        generation: 0,
        batchId,
        itemIndex,
        parentTokenId,
      },
      () => {},
    );
    return token;
  }

  /**
   * Stamp the payload with `seq`/`ts` via the run's EventLogger and dispatch
   * it to the registered handler. Use for pure notifications; state-mutating
   * events must go through `record()` to preserve write-ahead ordering.
   */
  private async emit(payload: EngineEventPayload): Promise<EngineEvent> {
    const stamped = await this.runDir.events.append(payload);
    this.options.onEvent?.(stamped);
    return stamped;
  }

  /**
   * Write-ahead event emission: append → mutate → dispatch.
   *
   * Guarantees that a crash between append and mutate leaves a log that
   * replay can reconstruct to the exact state the engine would have reached.
   * Use this for every event that reflects a state mutation; use `emit()`
   * only for pure notifications.
   */
  private async record<E extends EngineEvent>(
    payload: EngineEventPayload,
    apply: () => void,
  ): Promise<E> {
    const stamped = await this.runDir.events.append(payload);
    apply();
    this.options.onEvent?.(stamped);
    return stamped as E;
  }
}
