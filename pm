#!/usr/bin/env python3
"""pm — phase/task helper for plan.md-style files.

Usage:
  pm <file>                       List all phases and tasks
  pm pending <file>               List only phases/tasks still pending
  pm task next <file>             Show the next pending task (phase + task line)
  pm task view <ID> <file>        Show phase line + task title and body
  pm task complete <ID> <file>    Mark task as [x]
  pm task pending  <ID> <file>    Mark task as [ ]

A phase heading looks like:  ## Phase <N> — <title>
A task heading looks like:   ### [ ] P<N>-T<M> — <title>   (or [x])
"""
from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

PHASE_RE = re.compile(r"^## Phase (\d+)\b.*$")
TASK_RE = re.compile(r"^### \[([ xX])\] (P(\d+)-T(\d+))\b.*$")


@dataclass
class Task:
    id: str          # e.g. "P2-T3"
    line_no: int     # 1-based
    line: str        # raw line (no trailing newline)
    done: bool


@dataclass
class Phase:
    num: int
    line_no: int
    line: str
    tasks: list[Task] = field(default_factory=list)

    @property
    def fully_done(self) -> bool:
        return bool(self.tasks) and all(t.done for t in self.tasks)


def parse(path: Path) -> tuple[list[str], list[Phase]]:
    lines = path.read_text().splitlines()
    phases: list[Phase] = []
    current: Phase | None = None
    for i, raw in enumerate(lines, start=1):
        m = PHASE_RE.match(raw)
        if m:
            current = Phase(num=int(m.group(1)), line_no=i, line=raw)
            phases.append(current)
            continue
        m = TASK_RE.match(raw)
        if m and current is not None:
            current.tasks.append(
                Task(id=m.group(2), line_no=i, line=raw, done=m.group(1).lower() == "x")
            )
    return lines, phases


def cmd_list(path: Path, pending_only: bool = False) -> int:
    _, phases = parse(path)
    for ph in phases:
        if pending_only and ph.fully_done:
            continue
        print(f"{ph.line_no}:{ph.line}")
        for t in ph.tasks:
            if pending_only and t.done:
                continue
            print(f"{t.line_no}:{t.line}")
    return 0


def find_task(phases: list[Phase], task_id: str) -> tuple[Phase, Task] | None:
    tid = task_id.upper()
    for ph in phases:
        for t in ph.tasks:
            if t.id.upper() == tid:
                return ph, t
    return None


def cmd_task_next(path: Path) -> int:
    _, phases = parse(path)
    for ph in phases:
        for t in ph.tasks:
            if not t.done:
                print(f"{ph.line_no}:{ph.line}")
                print(f"{t.line_no}:{t.line}")
                return 0
    print("No pending tasks.", file=sys.stderr)
    return 1


def cmd_task_view(path: Path, task_id: str) -> int:
    lines, phases = parse(path)
    found = find_task(phases, task_id)
    if not found:
        print(f"Task {task_id} not found.", file=sys.stderr)
        return 1
    ph, t = found
    # Body = lines after task heading up to the next ### or ## heading.
    start = t.line_no  # 1-based, task heading itself
    end = len(lines)
    for j in range(start, len(lines)):
        nxt = lines[j]
        if nxt.startswith("### ") or nxt.startswith("## "):
            end = j
            break
    print(ph.line)
    for j in range(start - 1, end):
        print(lines[j])
    return 0


def cmd_task_toggle(path: Path, task_id: str, complete: bool) -> int:
    lines, phases = parse(path)
    found = find_task(phases, task_id)
    if not found:
        print(f"Task {task_id} not found.", file=sys.stderr)
        return 1
    _, t = found
    marker = "[x]" if complete else "[ ]"
    new_line = re.sub(r"^### \[[ xX]\]", f"### {marker}", lines[t.line_no - 1], count=1)
    if new_line == lines[t.line_no - 1]:
        print("No change.")
        return 0
    lines[t.line_no - 1] = new_line
    path.write_text("\n".join(lines) + ("\n" if path.read_text().endswith("\n") else ""))
    print(f"{t.line_no}:{new_line}")
    return 0


def usage(code: int = 2) -> int:
    print(__doc__, file=sys.stderr)
    return code


def main(argv: list[str]) -> int:
    args = argv[1:]
    if not args or args[0] in ("-h", "--help", "help"):
        return usage(0 if args else 2)

    # pm <file>
    if len(args) == 1:
        return cmd_list(Path(args[0]))

    # pm pending <file>
    if args[0] == "pending" and len(args) == 2:
        return cmd_list(Path(args[1]), pending_only=True)

    if args[0] == "task":
        if len(args) == 3 and args[1] == "next":
            return cmd_task_next(Path(args[2]))
        if len(args) == 4 and args[1] == "view":
            return cmd_task_view(Path(args[3]), args[2])
        if len(args) == 4 and args[1] in ("complete", "done"):
            return cmd_task_toggle(Path(args[3]), args[2], complete=True)
        if len(args) == 4 and args[1] == "pending":
            return cmd_task_toggle(Path(args[3]), args[2], complete=False)

    return usage()


if __name__ == "__main__":
    sys.exit(main(sys.argv))
