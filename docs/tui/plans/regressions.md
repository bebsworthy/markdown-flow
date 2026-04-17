# Regressions found during e2e

| Test | Description |
|---|---|
| T0003 | Ctrl-C exited 0 instead of 130 — Ink intercepts `\x03` in raw mode and calls `unmount()` without signaling. Fixed by tracking `quitViaQ` flag in `cli.tsx` and using exit code 130 for non-`q` unmounts. |
| T0200 | Modal overlays invisible in xterm-headless — `marginTop={-(stdout?.rows)}` wrote to negative y indices in Ink's output buffer, silently dropped. Fixed by replacing negative margins with `position="absolute"` on all overlay Boxes. |
