// src/app.tsx
//
// Root component. Wraps the tree in <ThemeProvider> and renders the
// <AppShell> chrome. In `browsing.workflows` mode, the top slot hosts the
// <WorkflowBrowser>; all other modes still show the scaffold placeholder
// until their owning task lands.
//
// The `q` quit binding is retained from the scaffold — it remains the
// canonical test hook for `scaffold.test.tsx`.

import React, { useEffect, useReducer, useState } from "react";
import { Text, useInput, useStdout } from "ink";
import { ThemeProvider } from "./theme/context.js";
import { AppShell } from "./components/app-shell.js";
import { ModeTabs } from "./components/mode-tabs.js";
import { WorkflowBrowser } from "./components/workflow-browser.js";
import { reducer, initialAppState } from "./state/reducer.js";
import { loadRegistry, resolveRegistryPath } from "./registry/index.js";
import type { RegistryState } from "./registry/types.js";

export interface AppProps {
  readonly onQuit: () => void;
  readonly registryConfig?: {
    readonly listPath: string | null;
    readonly persist: boolean;
  };
  readonly initialLaunchArgs?: ReadonlyArray<string>;
}

export function App({ onQuit, registryConfig }: AppProps): React.ReactElement {
  const [state, dispatch] = useReducer(reducer, initialAppState);
  const { stdout } = useStdout();

  const [registryState, setRegistryState] = useState<RegistryState>({
    entries: [],
  });
  const [registryPath, setRegistryPath] = useState<string | null>(null);
  const [, setRegistryLoaded] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    const cfg = registryConfig ?? { listPath: null, persist: true };
    const resolved = cfg.persist
      ? resolveRegistryPath(cfg.listPath, process.cwd())
      : null;
    setRegistryPath(resolved);
    if (resolved === null) {
      setRegistryLoaded(true);
      return () => {
        cancelled = true;
      };
    }
    loadRegistry(resolved).then(
      ({ state: loaded }) => {
        if (cancelled) return;
        setRegistryState(loaded);
        setRegistryLoaded(true);
      },
      () => {
        // Corruption handling deferred to P4-T3 (user-visible toast).
        if (cancelled) return;
        setRegistryLoaded(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [registryConfig]);

  useInput((input) => {
    if (input === "q") {
      onQuit();
    }
  });

  const persist = registryConfig?.persist ?? true;
  const topSlot =
    state.mode.kind === "browsing" && state.mode.pane === "workflows" ? (
      <WorkflowBrowser
        registryState={registryState}
        registryConfig={{
          path: registryPath,
          persist,
        }}
        selectedWorkflowId={state.selectedWorkflowId}
        dispatch={dispatch}
        width={stdout?.columns}
      />
    ) : (
      <Text>markflow-tui · scaffold</Text>
    );

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
        top={topSlot}
        bottom={<Text> </Text>}
      />
    </ThemeProvider>
  );
}
