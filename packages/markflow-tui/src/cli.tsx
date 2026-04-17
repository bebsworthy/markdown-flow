import { render } from "ink";
import { App } from "./app.js";
import { parseRegistryFlags } from "./cli-args.js";

let parsed;
try {
  parsed = parseRegistryFlags(process.argv.slice(2));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

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
  />,
);

waitUntilExit().then(
  () => process.exit(quitViaQ ? 0 : 130),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
