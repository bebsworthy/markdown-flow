import { render } from "ink";
import { createRunManager } from "markflow";
import { App } from "./app.js";
import { parseRegistryFlags } from "./cli-args.js";
import { toRunsTableRow } from "./runs/derive.js";
import { listWorkspaceRunsDirs } from "./workspace.js";

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

const runsDir = process.env.MARKFLOW_RUNS_DIR ?? null;

const initialRunRows = await (async () => {
  const now = Date.now();
  const rows: Array<ReturnType<typeof toRunsTableRow> & { runsDir: string }> = [];

  if (runsDir) {
    try {
      const infos = await createRunManager(runsDir).listRuns();
      for (const info of infos) rows.push({ ...toRunsTableRow(info, now), runsDir });
    } catch { /* ignore */ }
  }

  const wsDirs = await listWorkspaceRunsDirs(process.cwd());
  for (const wsRunsDir of wsDirs) {
    if (wsRunsDir === runsDir) continue;
    try {
      const infos = await createRunManager(wsRunsDir).listRuns();
      for (const info of infos) rows.push({ ...toRunsTableRow(info, now), runsDir: wsRunsDir });
    } catch { /* ignore */ }
  }

  return rows.length > 0 ? rows : undefined;
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
    runsDir={runsDir}
    initialRunRows={initialRunRows}
  />,
  { alternateScreen: !process.env.MARKFLOW_TEST },
);

waitUntilExit().then(
  () => {
    process.exit(quitViaQ ? 0 : 130);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
