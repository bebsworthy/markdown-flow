import { Text, useInput } from "ink";
import React from "react";

export interface AppProps {
  onQuit: () => void;
}

export function App({ onQuit }: AppProps): React.ReactElement {
  useInput((input) => {
    if (input === "q") {
      onQuit();
    }
  });

  return <Text>markflow-tui · scaffold</Text>;
}
