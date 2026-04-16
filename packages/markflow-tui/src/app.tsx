// src/app.tsx
//
// Root component. Wraps the tree in <ThemeProvider> and renders the
// <AppShell> chrome with placeholder slot content. Real top/bottom
// content lands in P4–P6.
//
// The `q` quit binding is retained from the scaffold — it remains the
// canonical test hook for `scaffold.test.tsx`.

import React, { useReducer } from "react";
import { Text, useInput, useStdout } from "ink";
import { ThemeProvider } from "./theme/context.js";
import { AppShell } from "./components/app-shell.js";
import { ModeTabs } from "./components/mode-tabs.js";
import { reducer, initialAppState } from "./state/reducer.js";

export interface AppProps {
  readonly onQuit: () => void;
  readonly registryConfig?: {
    readonly listPath: string | null;
    readonly persist: boolean;
  };
  readonly initialLaunchArgs?: ReadonlyArray<string>;
}

export function App({ onQuit }: AppProps): React.ReactElement {
  const [state, dispatch] = useReducer(reducer, initialAppState);
  const { stdout } = useStdout();

  useInput((input) => {
    if (input === "q") {
      onQuit();
    }
  });

  return (
    <ThemeProvider>
      <AppShell
        width={stdout?.columns}
        height={stdout?.rows}
        mode={state.mode}
        selectedRunId={state.selectedRunId}
        modeTabs={
          <ModeTabs
            mode={state.mode}
            selectedRunId={state.selectedRunId}
            dispatch={dispatch}
          />
        }
        top={<Text>markflow-tui · scaffold</Text>}
        bottom={<Text> </Text>}
      />
    </ThemeProvider>
  );
}
