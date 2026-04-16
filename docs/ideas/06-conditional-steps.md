# 06 — Conditional Step Inclusion

**Status:** REJECTED

## Reason

Flow is explicitly managed by the Mermaid graph. An `if:` condition on steps would add invisible flow control that bypasses the graph, undermining the principle that the flowchart is the single source of truth for execution topology. Conditional execution should be expressed as explicit branch nodes in the graph instead.
