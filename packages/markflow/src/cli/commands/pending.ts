import chalk from "chalk";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import {
  createRunManager,
  readEventLog,
  type EngineEvent,
} from "../../core/index.js";

export interface PendingOptions {
  json?: boolean;
}

interface PendingEntry {
  runId: string;
  workflowName: string;
  nodeId: string;
  tokenId: string;
  prompt: string;
  options: string[];
}

/**
 * Scan a workspace's runs directory for runs whose replayed snapshot has at
 * least one waiting token, and report the pending approvals.
 *
 * meta.json is the first-pass filter (status === "suspended"); the event log
 * is replayed only for candidates so we can extract the matching prompt and
 * options from the most recent `step:waiting` event per node.
 */
export async function pendingCommand(
  workspace: string,
  options: PendingOptions,
): Promise<void> {
  const runsDir = join(workspace, "runs");
  const manager = createRunManager(runsDir);

  let entries: string[];
  try {
    entries = await readdir(runsDir);
  } catch {
    if (!options.json) console.log(chalk.dim("No runs found."));
    else console.log("[]");
    return;
  }

  const pending: PendingEntry[] = [];

  for (const id of entries.sort()) {
    const info = await manager.getRun(id);
    if (!info || info.status !== "suspended") continue;

    let events: EngineEvent[];
    try {
      events = await readEventLog(join(runsDir, id));
    } catch {
      continue;
    }

    // Build node → latest step:waiting event, and track which nodes have been
    // decided after their most recent waiting event.
    const latestWaiting = new Map<
      string,
      { tokenId: string; prompt: string; options: string[]; seq: number }
    >();
    const decidedAfter = new Map<string, number>();

    for (const e of events) {
      if (e.type === "step:waiting") {
        latestWaiting.set(e.nodeId, {
          tokenId: e.tokenId,
          prompt: e.prompt,
          options: [...e.options],
          seq: e.seq,
        });
      } else if (e.type === "approval:decided") {
        decidedAfter.set(e.nodeId, e.seq);
      }
    }

    for (const [nodeId, w] of latestWaiting) {
      const decidedSeq = decidedAfter.get(nodeId);
      if (decidedSeq !== undefined && decidedSeq > w.seq) continue;
      pending.push({
        runId: id,
        workflowName: info.workflowName,
        nodeId,
        tokenId: w.tokenId,
        prompt: w.prompt,
        options: w.options,
      });
    }
  }

  if (options.json) {
    console.log(JSON.stringify(pending, null, 2));
    return;
  }

  if (pending.length === 0) {
    console.log(chalk.dim("No runs waiting for approval."));
    return;
  }

  console.log(
    chalk.bold(
      padRight("RUN", 34) +
        padRight("NODE", 22) +
        padRight("OPTIONS", 28) +
        "PROMPT",
    ),
  );
  for (const p of pending) {
    console.log(
      padRight(p.runId, 34) +
        padRight(p.nodeId, 22) +
        padRight(p.options.join(","), 28) +
        p.prompt,
    );
  }
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len - 1) + " " : s + " ".repeat(len - s.length);
}
