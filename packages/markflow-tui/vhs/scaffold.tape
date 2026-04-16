# scaffold.tape — records the empty markflow-tui scaffold.
# Run locally (not in CI yet): vhs scaffold.tape
# Prereq: `npm run build -w packages/markflow-tui` (produces ../dist/cli.js).

Output out/scaffold.gif

Set Shell "bash"
Set FontSize 14
Set Width 1200
Set Height 600
Set TypingSpeed 50ms
Set Theme "Dracula"

Type "node ../dist/cli.js"
Enter
Sleep 1s
Type "q"
Sleep 500ms
