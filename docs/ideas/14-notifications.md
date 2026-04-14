# 14 — Notifications / Alerts

**Tier:** Differentiating | **Effort:** Quick win (2 days) | **Priority:** Low-Medium

## Problem

Users want automatic alerts when workflows fail or complete without adding explicit notification steps to every workflow.

## Reference Implementations

- **GitHub Actions:** Email notifications, third-party Slack actions
- **Airflow:** `on_failure_callback`, `on_success_callback`, email operator
- **n8n:** Built-in Slack, email, Telegram nodes

## Proposed Design

### Configuration in `.workflow.json`

```json
{
  "notify": {
    "on": ["error", "complete"],
    "webhook": "$SLACK_WEBHOOK",
    "template": "Workflow {{ workflow.name }} {{ status }}: {{ summary }}"
  }
}
```

### Multiple notification targets

```json
{
  "notify": [
    { "on": ["error"], "webhook": "$SLACK_WEBHOOK" },
    { "on": ["complete"], "webhook": "$TEAMS_WEBHOOK" }
  ]
}
```

### Note

This can already be achieved today by adding notification steps with appropriate edges in the Mermaid graph. A built-in system is a convenience that avoids duplicating notification logic across workflows.

## Implementation Approach

1. Add `notify` config to `MarkflowConfig`.
2. In the CLI `run` command, register an `onEvent` handler that triggers notifications on `workflow:complete` or `workflow:error`.
3. Notifications are simple HTTP POST requests with a JSON payload.
4. Template the payload using the existing LiquidJS engine.

## What It Extends

- `MarkflowConfig` in `config.ts`
- `onEvent` callback in CLI's `run` command
- Template engine for payload rendering

## Key Files

- `src/core/config.ts`
- `src/cli/commands/run.ts`
- New: `src/core/notify.ts`

## Open Questions

- Should notification failures be silent or logged as warnings?
- Support for email (SMTP) in addition to webhooks?
- Should per-step notifications be supported (e.g., notify on specific step failure)?
- **Resume behavior (from idea 19):** if a run is resumed (log contains `run:resumed`) and then completes, should `workflow:complete` fire the notification again? Recommend yes — the run genuinely completed this time, and downstream consumers can de-dupe on `run.id`. Alternative is to suppress notifications when `run:resumed` is present in the log. Either policy needs to be explicit; pick before build.
