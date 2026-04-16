// src/theme/context.tsx
import React, { createContext, useContext, useMemo } from "react";
import { buildTheme, type Theme } from "./theme.js";
import { detectCapabilities } from "./capabilities.js";

const ThemeContext = createContext<Theme | null>(null);

export interface ThemeProviderProps {
  readonly children: React.ReactNode;
  /**
   * Explicit theme override (primarily for tests and for a future
   * `:theme` command-palette integration). If omitted, the provider
   * detects capabilities from `process.env` + `process.stdout.isTTY`
   * once at mount and memoises the result.
   */
  readonly value?: Theme;
}

export function ThemeProvider({
  children,
  value,
}: ThemeProviderProps): React.ReactElement {
  const theme = useMemo<Theme>(() => {
    if (value) return value;
    // The single unavoidable process-global read. All other theme code
    // is pure / input-driven.
    const caps = detectCapabilities(process.env, {
      stdoutIsTTY: Boolean(process.stdout.isTTY),
    });
    return buildTheme(caps);
  }, [value]);

  return (
    <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
  );
}

/**
 * Hook: returns the active Theme. Throws if used outside <ThemeProvider>
 * — silent fallback to a default theme would mask wiring bugs and break
 * the NO_COLOR guarantee.
 */
export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error("useTheme: no <ThemeProvider> in the component tree");
  }
  return theme;
}
