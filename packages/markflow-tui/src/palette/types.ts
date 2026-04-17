// src/palette/types.ts
//
// Pure types for the command palette (P7-T3).
//
// PURITY NOTE: no react/ink/node:*. Registered in test/state/purity.test.ts.

import type { AppContext } from "../components/types.js";
import type { AppState, Action as AppAction } from "../state/types.js";

/** Stable command identifiers — the enum the UI dispatches against. */
export type CommandId =
  | "run"
  | "resume"
  | "rerun"
  | "cancel"
  | "approve"
  | "pending"
  | "goto"
  | "theme"
  | "quit";

/** Catalogue row; the authoritative list lives in commands.ts. */
export interface Command {
  readonly id: CommandId;
  readonly name: string;
  readonly usage: string;
  readonly summary: string;
  readonly argRequired: boolean;
  readonly when: (ctx: AppContext) => boolean;
}

/** Filter-match with character indices for bold rendering. */
export interface CommandMatch {
  readonly command: Command;
  readonly matchedIndices: readonly number[];
  readonly score: number;
}

/** Local state for <CommandPaletteModal>. */
export interface PaletteState {
  readonly cursor: number;
  readonly fsm: "idle" | "running" | "error";
  readonly error: string | null;
}

export type PaletteAction =
  | { readonly type: "CURSOR_MOVE"; readonly delta: number }
  | { readonly type: "CURSOR_RESET_TO_FIRST" }
  | { readonly type: "RUN_START" }
  | { readonly type: "RUN_OK" }
  | { readonly type: "RUN_FAIL"; readonly error: string };

/** Typed outcome of a command execution. */
export type CommandResult =
  | { readonly kind: "ok" }
  | { readonly kind: "usage"; readonly message: string }
  | { readonly kind: "unavailable"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

/** Side-effects the palette can request. Injected by <App> at render time.
 *  exec.ts is pure but the closures on this interface perform IO. */
export interface CommandExecContext {
  readonly state: AppState;
  readonly dispatch: (action: AppAction) => void;
  readonly runsDir: string | null;
  readonly runActive: boolean;
  readonly runResumable: boolean;
  readonly pendingApprovalsCount: number;
  readonly runWorkflow: (workflowId: string) => Promise<CommandResult>;
  readonly resumeRun: (args: {
    readonly runId: string;
    readonly rerunNodes: readonly string[];
    readonly inputOverrides: Readonly<Record<string, string>>;
  }) => Promise<CommandResult>;
  readonly cancelRun: (runId: string) => Promise<CommandResult>;
  readonly openApproval: (runId: string) => CommandResult;
  readonly rotateTheme: () => void;
  readonly quit: () => void;
}
