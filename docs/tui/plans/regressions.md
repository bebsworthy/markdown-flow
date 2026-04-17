# Regressions found during e2e

| Test | Description |
|---|---|
| T0003 | Ctrl-C exited 0 instead of 130 — Ink intercepts `\x03` in raw mode and calls `unmount()` without signaling. Fixed by tracking `quitViaQ` flag in `cli.tsx` and using exit code 130 for non-`q` unmounts. |
