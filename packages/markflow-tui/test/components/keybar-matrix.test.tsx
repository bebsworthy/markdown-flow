// test/components/keybar-matrix.test.tsx
//
// Mode × width matrix acceptance test. One `describe.each` row per §15
// entry (10 modes × 3 widths = 30 `it` blocks). Each row's expected
// literal is taken verbatim from docs/tui/mockups.md §15.
//
// Colour and unicode are pinned via an explicit theme so lastFrame() is
// plain text. The stripAnsi helper strips any residual SGR codes.

import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ThemeProvider } from "../../src/theme/context.js";
import { buildTheme } from "../../src/theme/theme.js";
import { Keybar, type KeybarProps } from "../../src/components/keybar.js";
import type { Binding, AppContext } from "../../src/components/types.js";
import {
  workflowsBindings,
  browsingCtx,
  runsBindings,
  runsCtx,
  runGraphBindings,
  runGraphCtx,
  logFollowBindings,
  logFollowCtx,
  logPausedBindings,
  logPausedCtx,
  approvalBindings,
  approvalCtx,
  resumeBindings,
  resumeCtx,
  commandBindings,
  commandCtx,
  findBindings,
  findCtx,
  helpBindings,
  helpCtx,
} from "./fixtures.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

function renderKeybar(props: KeybarProps): ReturnType<typeof render> {
  return render(
    <ThemeProvider value={buildTheme({ color: false, unicode: true })}>
      <Keybar {...props} />
    </ThemeProvider>,
  );
}

interface Row {
  readonly mode: string;
  readonly bindings: ReadonlyArray<Binding>;
  readonly ctx: AppContext;
  readonly modePill?: string;
  readonly modePillTiers?: KeybarProps["modePillTiers"];
  readonly modePillGap?: KeybarProps["modePillGap"];
  readonly prefix?: KeybarProps["prefix"];
  readonly prefixGap?: KeybarProps["prefixGap"];
  readonly wide: string;
  readonly medium: string;
  readonly narrow: string;
  readonly skipWide?: boolean;
  readonly skipMedium?: boolean;
  readonly skipNarrow?: boolean;
  readonly skipReason?: string;
}

const ROWS: ReadonlyArray<Row> = [
  {
    mode: "WORKFLOWS",
    bindings: workflowsBindings,
    ctx: browsingCtx,
    wide: "\u2191\u2193 Select  \u23CE Open  r Run  e Edit in $EDITOR     ? Help   q Quit",
    medium: "\u2191\u2193 \u23CE r e    ? q",
    narrow: "\u2191\u2193 \u23CE r e ?",
  },
  {
    mode: "RUNS",
    bindings: runsBindings,
    ctx: runsCtx,
    wide: "\u2191\u2193 Select  \u23CE Open  r Resume  a Approve   s Status  / Search     ? q",
    medium: "\u2191\u2193 \u23CE r a  s /   ? q",
    narrow: "\u2191\u2193 \u23CE r a ?",
  },
  {
    mode: "RUN (graph)",
    bindings: runGraphBindings,
    ctx: runGraphCtx,
    wide: "\u2191\u2193 Step  \u23CE Logs  a Approve  R Re-run  X Cancel   VIEW  m  f  /    ? q",
    medium: "\u2191\u2193 \u23CE a R X   m f /    ? q",
    narrow: "\u2191\u2193 \u23CE R X  | f /  | ? q",
  },
  {
    mode: "LOG (follow)",
    bindings: logFollowBindings,
    ctx: logFollowCtx,
    prefix: { full: "LOG \u00b7 following", short: "LOG follow" },
    wide: "LOG \u00b7 following   w Wrap  t Timestamps  1/2/3 streams  / Search    Esc",
    medium: "LOG follow  w t 1/2/3 /   Esc",
    narrow: "w t /   Esc",
  },
  {
    mode: "LOG (paused)",
    bindings: logPausedBindings,
    ctx: logPausedCtx,
    prefix: { full: "LOG \u00b7 paused", short: "LOG paused" },
    wide: "LOG \u00b7 paused   F Resume  G Head  g Top  w Wrap  / Search    Esc",
    medium: "LOG paused  F G g w /   Esc",
    narrow: "F G g w /  Esc",
  },
  {
    mode: "APPROVAL",
    bindings: approvalBindings,
    ctx: approvalCtx,
    modePill: "APPROVAL",
    wide: "[APPROVAL]  \u23CE Decide  e Edit inputs  s Suspend-for-later    Esc Cancel  ?",
    medium: "[APPROVAL] \u23CE e s   Esc ?",
    narrow: "\u23CE e s   Esc",
  },
  {
    mode: "RESUME",
    bindings: resumeBindings,
    ctx: resumeCtx,
    modePill: "RESUME",
    wide: "[RESUME]  \u23CE Resume  Space Toggle  Tab Next  p Preview    Esc    ?",
    medium: "[RESUME] \u23CE Space Tab p   Esc ?",
    narrow: "\u23CE Space Tab p  Esc",
  },
  {
    mode: "COMMAND",
    bindings: commandBindings,
    ctx: commandCtx,
    modePill: "COMMAND",
    modePillTiers: ["full"],
    modePillGap: { full: 3 },
    wide: "[COMMAND]   \u23CE Run  \u2191\u2193 Select  Tab Complete    Esc Cancel",
    medium: "\u23CE \u2191\u2193 Tab   Esc",
    narrow: "\u23CE \u2191\u2193 Tab  Esc",
  },
  {
    mode: "FIND",
    bindings: findBindings,
    ctx: findCtx,
    modePill: "FIND",
    modePillTiers: ["full"],
    modePillGap: { full: 3 },
    wide: "[FIND]   \u23CE Open  \u2191\u2193 Select    Esc Cancel",
    medium: "\u23CE \u2191\u2193   Esc",
    narrow: "\u23CE \u2191\u2193  Esc",
  },
  {
    mode: "HELP",
    bindings: helpBindings,
    ctx: helpCtx,
    modePill: "HELP",
    modePillTiers: ["full"],
    modePillGap: { full: 3 },
    wide: "[HELP]   \u2191\u2193 Navigate   / Search   Esc Close",
    medium: "\u2191\u2193 / Esc",
    narrow: "\u2191\u2193 / Esc",
  },
];

describe.each(ROWS)("keybar matrix — $mode", (row) => {
  const testWide = row.skipWide ? it.skip : it;
  const testMedium = row.skipMedium ? it.skip : it;
  const testNarrow = row.skipNarrow ? it.skip : it;

  testWide(
    `width \u2265100 \u2192 full tier${row.skipWide ? " (TODO: P3-T4 plan §11 — " + row.skipReason + ")" : ""}`,
    () => {
      const out = renderKeybar({
        bindings: row.bindings,
        ctx: row.ctx,
        width: 120,
        modePill: row.modePill,
        modePillTiers: row.modePillTiers,
        modePillGap: row.modePillGap,
        prefix: row.prefix,
        prefixGap: row.prefixGap,
      });
      expect(stripAnsi(out.lastFrame() ?? "")).toBe(row.wide);
    },
  );

  testMedium(
    `width 80 \u2192 short tier${row.skipMedium ? " (TODO: P3-T4 plan §11 — " + row.skipReason + ")" : ""}`,
    () => {
      const out = renderKeybar({
        bindings: row.bindings,
        ctx: row.ctx,
        width: 80,
        modePill: row.modePill,
        modePillTiers: row.modePillTiers,
        modePillGap: row.modePillGap,
        prefix: row.prefix,
        prefixGap: row.prefixGap,
      });
      expect(stripAnsi(out.lastFrame() ?? "")).toBe(row.medium);
    },
  );

  testNarrow(
    `width 40 \u2192 keys tier${row.skipNarrow ? " (TODO: P3-T4 plan §11 — " + row.skipReason + ")" : ""}`,
    () => {
      const out = renderKeybar({
        bindings: row.bindings,
        ctx: row.ctx,
        width: 40,
        modePill: row.modePill,
        modePillTiers: row.modePillTiers,
        modePillGap: row.modePillGap,
        prefix: row.prefix,
        prefixGap: row.prefixGap,
        keysTierHint: "",
      });
      expect(stripAnsi(out.lastFrame() ?? "")).toBe(row.narrow);
    },
  );
});
