import { render } from "ink";
import React from "react";
import { App } from "./app.js";
import { parseRegistryFlags } from "./cli-args.js";

let parsed;
try {
  parsed = parseRegistryFlags(process.argv.slice(2));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const { unmount, waitUntilExit } = render(
  <App
    onQuit={() => unmount()}
    registryConfig={parsed.config}
    initialLaunchArgs={parsed.rest}
  />,
);

waitUntilExit().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
