import { spawnTui, DEFAULT_READY_MS } from "./harness.js";
import { createScratchEnv } from "./tmp.js";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const WORKFLOW = [
  "# Wf", "", "# Flow", "", "```mermaid", "flowchart TD", "  s1 --> s2", "```",
  "", "# Steps", "", "## s1", "", "```bash", 'echo "s1"', "```",
  "", "## s2", "", "```bash", 'echo "s2"', "```",
].join("\n");

const scratch = await createScratchEnv();
const wfPath = path.join(scratch.dir, "wf.md");
await writeFile(wfPath, WORKFLOW, "utf8");
await scratch.writeRegistry([{ source: wfPath }]);

const session = await spawnTui({ scratch, args: [wfPath], cols: 120, rows: 36 });
await session.waitForText("1 entry", DEFAULT_READY_MS);

console.log("\n=== WORKFLOWS MODE ===");
let raw = session.screen();
let lines = raw.split("\n");
console.log(`Lines: ${lines.length}`);
lines.forEach((l: string, i: number) => console.log(`${String(i+1).padStart(3)}: ${JSON.stringify(l)}`));

// Switch to RUNS
session.write("2");
await session.waitForRegex(/RUNS/, DEFAULT_READY_MS);
await new Promise(r => setTimeout(r, 500));

console.log("\n=== RUNS MODE ===");
raw = session.screen();
lines = raw.split("\n");
console.log(`Lines: ${lines.length}`);
lines.forEach((l: string, i: number) => console.log(`${String(i+1).padStart(3)}: ${JSON.stringify(l)}`));

await session.kill();
await scratch.cleanup();
process.exit(0);
