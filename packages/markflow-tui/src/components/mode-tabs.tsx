// src/components/mode-tabs.tsx
//
// Top-of-frame mode-tab row for the app shell. Renders
//
//    WORKFLOWS  RUNS  RUN
//
// with the active tab wrapped in a reverse-video pill (`[ RUNS ]` style).
// Wires F1/F2/F3 and `1`/`2`/`3` keystrokes via `useInput` through the
// pure `keyToMode` helper.
//
// Authoritative references:
//   - docs/tui/plans/P3-T5.md §2.2
//   - docs/tui/features.md §5.6 rule 5 (hide-don't-grey), rule 8 (mode pill)
//   - docs/tui/mockups.md §1, §4
//
// Color policy: all color decisions go through `useTheme()`. The active
// tab uses structural `inverse`/`bold` Ink props per §5.6 rule 8 — NOT a
// theme color literal.

import React from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme/context.js";
import type { Action, AppState } from "../state/types.js";
import {
  activeTabFromMode,
  frameTitle,
  keyToMode,
  pickActiveTabStyle,
  type ModeTabKey,
} from "./app-shell-layout.js";

export interface ModeTabsProps {
  readonly mode: AppState["mode"];
  readonly selectedRunId: string | null;
  readonly dispatch: (action: Action) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Splits the title string produced by `frameTitle()` back into its token
 * sequence so each token can be wrapped in its own styled `<Text>`. Tokens
 * are either a whitespace run (" " / "  ") or a word. The active tab is
 * emitted as the literal `[ WORD ]` with its surrounding brackets so we
 * can apply the inverse-video Ink prop to the whole pill.
 */
function tokenizeTitle(
  title: string,
): ReadonlyArray<{ readonly kind: "word" | "space"; readonly text: string }> {
  const out: Array<{ kind: "word" | "space"; text: string }> = [];
  // The title is a small, controlled string — simple char-by-char scan.
  let i = 0;
  while (i < title.length) {
    const ch = title[i]!;
    if (ch === " ") {
      let j = i;
      while (j < title.length && title[j] === " ") j++;
      out.push({ kind: "space", text: title.slice(i, j) });
      i = j;
    } else if (ch === "[") {
      // A pill starts with "[ TEXT ]" — find the matching closing bracket.
      const end = title.indexOf("]", i);
      if (end < 0) {
        // Shouldn't happen — `frameTitle` always pairs brackets. Fall back.
        out.push({ kind: "word", text: title.slice(i) });
        break;
      }
      out.push({ kind: "word", text: title.slice(i, end + 1) });
      i = end + 1;
    } else {
      let j = i;
      while (j < title.length && title[j] !== " " && title[j] !== "[") j++;
      out.push({ kind: "word", text: title.slice(i, j) });
      i = j;
    }
  }
  return out;
}

/**
 * Resolves the tab key for a given tokenized word. A bare word like
 * "WORKFLOWS" maps to "WORKFLOWS"; a pill like "[ RUNS ]" maps to "RUNS".
 * Returns `null` for whitespace or unknown tokens.
 */
function wordToTab(word: string): ModeTabKey | null {
  if (word === "WORKFLOWS") return "WORKFLOWS";
  if (word === "RUNS") return "RUNS";
  if (word === "RUN") return "RUN";
  if (word === "[ WORKFLOWS ]") return "WORKFLOWS";
  if (word === "[ RUNS ]") return "RUNS";
  if (word === "[ RUN ]") return "RUN";
  return null;
}

// ---------------------------------------------------------------------------
// ModeTabs component
// ---------------------------------------------------------------------------

function ModeTabsImpl({
  mode,
  selectedRunId,
  dispatch,
}: ModeTabsProps): React.ReactElement {
  const theme = useTheme();

  useInput((input, _key) => {
    // Ink 5's Key type does not expose explicit F1/F2/F3 flags; F-keys
    // arrive as raw ANSI escape sequences in `input` (e.g. "\x1bOP"). The
    // pure helper `keyToMode` recognises the common SS3 / CSI variants.
    const action = keyToMode({ input }, { mode, selectedRunId });
    if (action !== null) {
      dispatch(action);
    }
  });

  const active = activeTabFromMode(mode);
  // Hide-don't-grey (features.md §5.6 rule 5): when browsing with no run
  // selected, the RUN tab is omitted entirely rather than dimmed.
  const hideRun = mode.kind === "browsing" && selectedRunId === null;
  const title = frameTitle(active, { hideRun });
  const tokens = tokenizeTitle(title);

  return (
    <Box flexDirection="row">
      {tokens.map((tok, idx) => {
        if (tok.kind === "space") {
          return <Text key={idx}>{tok.text}</Text>;
        }
        const tab = wordToTab(tok.text);
        if (tab === null) {
          return <Text key={idx}>{tok.text}</Text>;
        }
        const style = pickActiveTabStyle(tab, active);
        if (style.inverse) {
          return (
            <Text key={idx} inverse bold>
              {tok.text}
            </Text>
          );
        }
        return (
          <Text
            key={idx}
            color={theme.colors.accent.color}
            dimColor={theme.colors.accent.dim === true}
          >
            {tok.text}
          </Text>
        );
      })}
    </Box>
  );
}

// React.memo removed: React 19.2 + useEffectEvent bug with SimpleMemoComponent fibers (stale useInput state).
export const ModeTabs = ModeTabsImpl;
