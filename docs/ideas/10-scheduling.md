# 10 — Scheduling / Cron Triggers

**Tier:** High Value | **Effort:** Quick to Medium (1-4 days) | **Priority:** Medium

## Problem

Users need to run workflows on recurring schedules (batch jobs, periodic syncs, health checks, report generation) without relying on external cron configuration.

## Reference Implementations

- **GitHub Actions:** `on: schedule: - cron: '0 9 * * MON-FRI'`
- **Airflow:** Scheduler is the core abstraction; `schedule_interval` per DAG
- **Prefect:** `CronSchedule`, `IntervalSchedule`, `RRuleSchedule`
- **n8n:** Cron trigger node

## Proposed Design

### Option A: External (zero engine changes)

Document how to use OS cron, systemd timers, or launchd to invoke `markflow run`:

```bash
# crontab -e
0 9 * * MON-FRI cd /path/to/workspace && markflow run workflow.md
```

### Option B: Markdown section

```markdown
# Schedule

- `0 9 * * MON-FRI`: Weekday morning run
- `*/30 * * * *`: Every 30 minutes
```

### Option C: Config file

`.workflow.json`:
```json
{
  "schedule": [
    { "cron": "0 9 * * MON-FRI", "label": "Weekday morning" },
    { "cron": "*/30 * * * *", "label": "Frequent check" }
  ]
}
```

### Daemon command

```bash
# Start scheduler daemon
markflow daemon [workspace-dir]

# List scheduled workflows
markflow daemon --list

# Run in foreground (for Docker/systemd)
markflow daemon --foreground
```

## Implementation Approach

### Quick path (Option A): Documentation only. Zero code changes.

### Built-in path (Options B/C):
1. Parse `# Schedule` section or config file schedule entries.
2. New `markflow daemon` command that:
   - Loads all workflow files in a directory (or a specified list)
   - Evaluates cron expressions against current time
   - Invokes `executeWorkflow` on matches
   - Manages concurrent run limits (don't start a new run if prior is still running)
3. Use a lightweight cron library (`cron-parser` or `croner`).

### Resilience via resume (idea 19)

Because runs are event-sourced (idea 18) and resumable (idea 19), the daemon gains recovery-from-restart for free: on startup, scan `runs/` for runs whose last event is not terminal (`workflow:complete` / `workflow:error`) and invoke `RunManager.openExistingRun(id)` + `executeWorkflow(workflow, { resumeFrom: handle })` to continue them. This covers daemon crashes, deploys, and OS reboots without requiring a scheduler database. Note the concurrent-resume gap flagged in 19 — if anything else might also resume a run, add a lock file.

## What It Extends

- `parser/markdown.ts` — new optional `# Schedule` section
- CLI — new `daemon` command
- `WorkflowDefinition` — optional `schedule` field

## Key Files

- `src/core/parser/markdown.ts`
- `src/core/types.ts`
- New: `src/cli/commands/daemon.ts`

## Open Questions

- Should the daemon manage multiple workflow files or one at a time?
- Timezone handling? Default to local or UTC?
- Overlap policy: skip if running, queue, or allow concurrent?
- Should schedule info be in the markdown file (single-file philosophy) or external config?
