// src/palette/commands.ts
//
// Canonical command catalogue for the palette (P7-T3). Pure data.
// References: plan.md P7-T3 scope; mockups.md §10.

import type { Command } from "./types.js";

export const COMMANDS: readonly Command[] = [
  {
    id: "run",
    name: "run",
    usage: ":run <workflow>",
    summary: "Start a new run",
    argRequired: true,
    when: () => true,
  },
  {
    id: "resume",
    name: "resume",
    usage: ":resume [<id>]",
    summary: "Resume suspended/failed run",
    argRequired: false,
    when: () => true,
  },
  {
    id: "rerun",
    name: "rerun",
    usage: ":rerun <node>",
    summary: "Re-run a node in the current run",
    argRequired: true,
    when: (ctx) => ctx.mode.kind === "viewing" && ctx.runResumable === true,
  },
  {
    id: "cancel",
    name: "cancel",
    usage: ":cancel",
    summary: "Cancel the current run",
    argRequired: false,
    when: (ctx) => ctx.mode.kind === "viewing" && ctx.runActive === true,
  },
  {
    id: "approve",
    name: "approve",
    usage: ":approve [edge]",
    summary: "Decide pending approval",
    argRequired: false,
    when: (ctx) => (ctx.pendingApprovalsCount ?? 0) > 0,
  },
  {
    id: "pending",
    name: "pending",
    usage: ":pending",
    summary: "Jump to pending-approvals list",
    argRequired: false,
    when: () => true,
  },
  {
    id: "goto",
    name: "goto",
    usage: ":goto <seq>",
    summary: "Jump event-log cursor to seq",
    argRequired: true,
    when: (ctx) => ctx.mode.kind === "viewing",
  },
  {
    id: "theme",
    name: "theme",
    usage: ":theme",
    summary: "Rotate color theme",
    argRequired: false,
    when: () => true,
  },
  {
    id: "quit",
    name: "quit",
    usage: ":quit",
    summary: "Exit markflow-tui",
    argRequired: false,
    when: () => true,
  },
];

/** O(1) lookup by `name` (what follows `:`). */
export const COMMAND_BY_NAME: ReadonlyMap<string, Command> = new Map(
  COMMANDS.map((c) => [c.name, c]),
);
