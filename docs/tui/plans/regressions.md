# Regressions found during e2e

| Test | Description |
|---|---|
| T0003 | Ctrl-C exited 0 instead of 130 — Ink intercepts `\x03` in raw mode and calls `unmount()` without signaling. Fixed by tracking `quitViaQ` flag in `cli.tsx` and using exit code 130 for non-`q` unmounts. |
| T0200 | Modal overlays invisible in xterm-headless — `marginTop={-(stdout?.rows)}` wrote to negative y indices in Ink's output buffer, silently dropped. Fixed by replacing negative margins with `position="absolute"` on all overlay Boxes. |
| T0301 | Runs table showed "no runs yet" despite existing runs on disk — `cli.tsx` never loaded runs from `MARKFLOW_RUNS_DIR` via `createRunManager().listRuns()` into `initialRunRows`. Fixed by adding a top-level await in `cli.tsx` to scan runs before mounting the App. |
| T0302 | Sort indicator missing from runs footer — mockups §1 shows `sort: attention ↓` but `RunsFooter` only rendered counts. Fixed by adding `sortKey` prop to `RunsFooter` and rendering the label. |
