// src/components/keybar-fixtures/registry.ts
//
// Single source of truth mapping `(mode, overlay, engineHints)` → keybar
// fixture. Consumed by both <App>'s keybar renderer and <HelpOverlay>'s
// `deriveHelpModel` so help content is derived from the same keymap the
// keybar is using (P7-T3, features.md §5.6 rule 8).
//
// PURITY NOTE: data-only. No react/ink/node:*. Listed in purity.test.ts.

import type { AppState } from "../../state/types.js";
import type { Binding } from "../types.js";
import { APPROVAL_KEYBAR } from "./approval.js";
import { COMMAND_KEYBAR } from "./command.js";
import { EVENTS_FOLLOWING_KEYBAR, EVENTS_PAUSED_KEYBAR } from "./events.js";
import { GRAPH_KEYBAR } from "./graph.js";
import { HELP_KEYBAR } from "./help.js";
import { LOG_FOLLOWING_KEYBAR, LOG_PAUSED_KEYBAR } from "./log.js";
import { RESUME_KEYBAR } from "./resume.js";
import { WORKFLOWS_KEYBAR } from "./workflows.js";
import { WORKFLOWS_EMPTY_KEYBAR } from "./workflows-empty.js";

export interface SelectKeybarArgs {
  readonly mode: AppState["mode"];
  readonly overlay: AppState["overlay"];
  readonly logFollowing: boolean;
  readonly eventsFollowing: boolean;
  readonly registryEmpty: boolean;
}

export interface KeybarSelection {
  readonly bindings: readonly Binding[];
  readonly modePill: string | null;
  readonly modeLabel: string;
  readonly focusLabel: string;
}

const EMPTY: readonly Binding[] = [];

/** Pure. Deterministic. */
export function selectKeybarFixture(
  args: SelectKeybarArgs,
): KeybarSelection {
  const { mode, overlay, logFollowing, eventsFollowing, registryEmpty } = args;

  // Overlay wins when open.
  if (overlay !== null) {
    switch (overlay.kind) {
      case "approval":
        return {
          bindings: APPROVAL_KEYBAR,
          modePill: "APPROVAL",
          modeLabel: "APPROVAL",
          focusLabel: "",
        };
      case "resumeWizard":
        return {
          bindings: RESUME_KEYBAR,
          modePill: "RESUME",
          modeLabel: "RESUME",
          focusLabel: "",
        };
      case "commandPalette":
        return {
          bindings: COMMAND_KEYBAR,
          modePill: "COMMAND",
          modeLabel: "COMMAND",
          focusLabel: "",
        };
      case "help":
        return {
          bindings: HELP_KEYBAR,
          modePill: "HELP",
          modeLabel: "HELP",
          focusLabel: "",
        };
      case "addWorkflow":
        return {
          bindings: EMPTY,
          modePill: null,
          modeLabel: "ADD",
          focusLabel: "",
        };
      case "confirmCancel":
        return {
          bindings: GRAPH_KEYBAR,
          modePill: "CONFIRM",
          modeLabel: "CONFIRM",
          focusLabel: "",
        };
    }
  }

  if (mode.kind === "browsing") {
    if (mode.pane === "workflows") {
      return {
        bindings: registryEmpty ? WORKFLOWS_EMPTY_KEYBAR : WORKFLOWS_KEYBAR,
        modePill: null,
        modeLabel: "WORKFLOWS",
        focusLabel: "workflows",
      };
    }
    return {
      bindings: EMPTY,
      modePill: null,
      modeLabel: "RUNS",
      focusLabel: "runs",
    };
  }

  // viewing.*
  switch (mode.focus) {
    case "graph":
      return {
        bindings: GRAPH_KEYBAR,
        modePill: null,
        modeLabel: "RUN",
        focusLabel: "graph",
      };
    case "detail":
      return {
        bindings: GRAPH_KEYBAR,
        modePill: null,
        modeLabel: "RUN",
        focusLabel: "detail",
      };
    case "log":
      return {
        bindings: logFollowing ? LOG_FOLLOWING_KEYBAR : LOG_PAUSED_KEYBAR,
        modePill: null,
        modeLabel: "RUN",
        focusLabel: "log",
      };
    case "events":
      return {
        bindings: eventsFollowing
          ? EVENTS_FOLLOWING_KEYBAR
          : EVENTS_PAUSED_KEYBAR,
        modePill: null,
        modeLabel: "RUN",
        focusLabel: "events",
      };
  }
}
