# Plane Ticket Analysis

Fetches a ticket from a Plane project management instance, runs a format
analysis against it using Claude Haiku, and posts the findings back as a
comment on the ticket.

**Format rule checked:** Every ticket description must include a `## Problem`
section and either a `## Steps to Reproduce` section (bugs) or an
`## Acceptance Criteria` section (features/improvements).

# Inputs

- `PLANE_URL` (default: `https://api.plane.so`): Base URL of your Plane instance's API
- `PLANE_API_KEY` (required): Plane API key (from workspace settings → API tokens)
- `WORKSPACE_SLUG` (required): Workspace slug (visible in your Plane URL)
- `PROJECT_ID` (required): UUID of the project containing the ticket
- `ISSUE_ID` (required): UUID of the issue to analyze (not the display ID like TEST-4 — find it in the Plane URL or via the API)

# Flow

```mermaid
flowchart TD
  fetch-ticket -->|pass| analyze-ticket
  fetch-ticket -->|fail| error

  analyze-ticket --> post-comment

  post-comment -->|pass| done
  post-comment -->|fail max:2| post-comment
  post-comment -->|fail:max| error
```

# Steps

## fetch-ticket

Fetch the issue from the Plane API and save it to `ticket.json` in the
working directory so subsequent steps can read it.

```bash
ISSUE_URL="${PLANE_URL}/api/v1/workspaces/${WORKSPACE_SLUG}/projects/${PROJECT_ID}/work-items/${ISSUE_ID}/"

echo "Fetching ticket from Plane API: ${ISSUE_URL}"

HTTP_CODE=$(curl -s \
  -o "${MARKFLOW_WORKDIR}/ticket.json" \
  -w "%{http_code}" \
  -H "X-API-Key: ${PLANE_API_KEY}" \
  -H "Accept: application/json" \
  "${ISSUE_URL}")

if [ "${HTTP_CODE}" != "200" ]; then
  BODY=$(cat "${MARKFLOW_WORKDIR}/ticket.json" 2>/dev/null || echo "(no response body)")
  echo "RESULT: {\"edge\": \"fail\", \"summary\": \"Plane API returned HTTP ${HTTP_CODE}: ${BODY}\"}"
  exit 1
fi

TITLE=$(python3 -c "
import json
d = json.load(open('${MARKFLOW_WORKDIR}/ticket.json'))
print(d.get('name', '(no title)'))
" 2>/dev/null || echo "(unknown title)")

echo "RESULT: {\"edge\": \"pass\", \"summary\": \"Fetched: ${TITLE}\"}"
```

## analyze-ticket

```config
agent: claude
flags:
  - --model
  - haiku
  - --dangerously-skip-permissions
```

Read the file `ticket.json` in ${MARKFLOW_WORKDIR}. It contains a Plane
issue as JSON. Extract the `name` (title) and `description` fields.

Evaluate the description against this format rule:

> **Format Rule v1**: Every ticket description must include:
> 1. A `## Problem` section — explains what the issue is.
> 2. Either a `## Steps to Reproduce` section (for bugs) **or** an
>    `## Acceptance Criteria` section (for features/improvements).

Write a structured analysis report to `analysis.md` in the current directory
using this exact template:

```
## Ticket Format Analysis

**Ticket:** <title>

**Format check:** PASS ✓  (or FAIL ✗)

**Sections found:**
- `## Problem`: present / missing
- `## Steps to Reproduce`: present / missing
- `## Acceptance Criteria`: present / missing

**Summary:** <one or two sentences describing what the ticket is about>

**Recommendations:** <if FAIL: concrete suggestions for what is missing;
if PASS: "Ticket meets the format requirements.">
```

Once you have written `analysis.md`, output:

RESULT: {"edge": "done", "summary": "<PASS or FAIL> — <one sentence from your Summary field>"}

## post-comment

Read `analysis.md` from the working directory and post it as a comment on the
Plane issue.

```bash
set -euo pipefail

ANALYSIS=$(cat "${MARKFLOW_WORKDIR}/analysis.md")

COMMENT_URL="${PLANE_URL}/api/v1/workspaces/${WORKSPACE_SLUG}/projects/${PROJECT_ID}/work-items/${ISSUE_ID}/comments/"

HTTP_CODE=$(curl -s \
  -o "${MARKFLOW_WORKDIR}/comment.json" \
  -w "%{http_code}" \
  -X POST \
  -H "X-API-Key: ${PLANE_API_KEY}" \
  -H "Content-Type: application/json" \
  --data-binary "$(python3 -c "
import json, sys
analysis = open('${MARKFLOW_WORKDIR}/analysis.md').read()
print(json.dumps({'comment_html': '<pre>' + analysis + '</pre>'}))
")" \
  "${COMMENT_URL}")

if [ "${HTTP_CODE}" != "201" ]; then
  echo "Failed to post comment: HTTP ${HTTP_CODE}" >&2
  exit 1
fi

echo "Comment posted successfully"
```

## done

```bash
echo "Analysis complete. Comment posted to issue ${ISSUE_ID}."
```

## error

```bash
echo "Workflow failed. Check the run log for details." >&2
exit 1
```
