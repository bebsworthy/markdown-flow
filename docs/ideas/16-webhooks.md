# 16 — Webhooks / Event Triggers

**Tier:** Differentiating | **Effort:** Deep (5-8 days) | **Priority:** Low

## Problem

Users want to trigger workflows from external events (GitHub webhooks, Slack commands, API calls, CI callbacks) without manual CLI invocation.

## Reference Implementations

- **GitHub Actions:** `on: push`, `on: pull_request`, `on: workflow_dispatch`
- **n8n:** Webhook trigger node (instant or polling)
- **Zapier:** Trigger step (webhook, schedule, or app event)

## Proposed Design

### Markdown section

```markdown
# Triggers

- `webhook`: POST /hooks/deploy (payload → `{{ GLOBAL.webhook }}`)
- `webhook`: POST /hooks/review (secret: $WEBHOOK_SECRET)
```

### Server command

```bash
# Start webhook server
markflow serve --port 3000

# With auth
markflow serve --port 3000 --secret $WEBHOOK_SECRET
```

### Payload mapping

The webhook body is injected as `GLOBAL.webhook`:

```json
{
  "webhook": {
    "method": "POST",
    "headers": { ... },
    "body": { ... },
    "query": { ... }
  }
}
```

Steps access it via templates: `{{ GLOBAL.webhook.body.action }}`

## Implementation Approach

1. New `markflow serve` command with a lightweight HTTP server (Node.js `http` module).
2. Route configuration from `# Triggers` section or `.workflow.json`.
3. On webhook receipt: validate secret, parse payload, invoke `executeWorkflow` with payload as input.
4. Return run ID in response for tracking.
5. Concurrent workflow execution with configurable limits.

## What It Extends

- Parser (`# Triggers` section)
- CLI (new `serve` command)
- Workflow inputs system (payload → inputs)

## Key Files

- `src/core/parser/markdown.ts`
- New: `src/cli/commands/serve.ts`
- New: `src/core/webhook-server.ts`

### Resume callback surface (idea 19)

The resume primitive from idea 19 makes webhooks a natural inbound surface for features that wait for external signals. Most notably, once idea 04 (approval nodes) lands, the `serve` command routes:

```
POST /hooks/approve/<runId>
```

through `RunManager.openExistingRun(runId)` + append `approval:decided` (04's event) + `executeWorkflow(workflow, { resumeFrom: handle })`. The webhook server becomes the HTTP delivery mechanism for resume; 04 defines the semantics, 16 provides the transport.

Inherited gap: idea 19 flagged concurrent-resume as a known hazard (two callers opening the same run). A webhook server is the most likely place for this to happen in practice — add a per-run lock file or CAS on `lastSeq` at first append before shipping 04 over this surface.

## Single-File Tension

Moderate — the runtime requirement (long-running HTTP server) is a significant departure from the CLI-first model. The trigger configuration itself fits naturally in the markdown file.

## Open Questions

- Authentication beyond shared secrets (HMAC, OAuth)?
- Rate limiting and concurrent run management?
- Should the server support multiple workflow files?
- Health check endpoint?
