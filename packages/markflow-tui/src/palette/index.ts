// src/palette/index.ts — barrel for the command palette module (P7-T3).

export * from "./types.js";
export { COMMANDS, COMMAND_BY_NAME } from "./commands.js";
export { matchCommand, filterCommands } from "./fuzzy.js";
export { parseInput } from "./parser.js";
export { initialPaletteState, paletteReducer } from "./reducer.js";
export { executeCommand } from "./exec.js";
