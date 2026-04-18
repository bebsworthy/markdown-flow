import { render } from "ink";
import { createRunManager } from "markflow";
import { App } from "./app.js";
import { parseRegistryFlags } from "./cli-args.js";
import { toRunsTableRow } from "./runs/derive.js";

if (!process.stdout.isTTY) {
  console.error(
    "markflow-tui requires an interactive terminal.\n" +
      "For non-interactive use, try: markflow run --plain <workflow>",
  );
  process.exit(1);
}

let parsed;
try {
  parsed = parseRegistryFlags(process.argv.slice(2));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const initialRunRows = await (async () => {
  if (!parsed.runsDir) return undefined;
  try {
    const infos = await createRunManager(parsed.runsDir).listRuns();
    const now = Date.now();
    return infos.map((info) => toRunsTableRow(info, now));
  } catch {
    return undefined;
  }
})();

let quitViaQ = false;

// Enter alternate screen buffer so the TUI owns the full terminal
// and doesn't pollute scrollback. Restored on exit.
// Skipped under MARKFLOW_TEST — xterm headless can't read the alt buffer.
const ALT_SCREEN_ON = "\x1b[?1049h";
const ALT_SCREEN_OFF = "\x1b[?1049l";
const useAltScreen = !process.env.MARKFLOW_TEST;
if (useAltScreen) process.stdout.write(ALT_SCREEN_ON);

const { unmount, waitUntilExit } = render(
  <App
    onQuit={() => {
      quitViaQ = true;
      unmount();
    }}
    registryConfig={parsed.config}
    initialLaunchArgs={parsed.rest}
    runsDir={parsed.runsDir}
    initialRunRows={initialRunRows}
  />,
);

waitUntilExit().then(
  () => {
    if (useAltScreen) process.stdout.write(ALT_SCREEN_OFF);
    process.exit(quitViaQ ? 0 : 130);
  },
  (err) => {
    if (useAltScreen) process.stdout.write(ALT_SCREEN_OFF);
    console.error(err);
    process.exit(1);
  },
);
