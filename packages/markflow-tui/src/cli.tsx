import { render } from "ink";
import React from "react";
import { App } from "./app.js";

const { unmount, waitUntilExit } = render(<App onQuit={() => unmount()} />);

waitUntilExit().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
