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
  () => process.exit(quitViaQ ? 0 : 130),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
