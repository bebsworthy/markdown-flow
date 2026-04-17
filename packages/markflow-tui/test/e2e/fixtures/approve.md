# Approval Pipeline

Two scripts bracketing an approval gate. Used by the Journey 3 e2e test.

# Flow

```mermaid
flowchart TD
  build --> gate
  gate -->|yes| ship
  gate -->|no| stop
```

# Steps

## build

```bash
echo "built"
```

## gate

```config
type: approval
prompt: Ship?
options:
  - yes
  - no
```

Reviewer notes: approve to ship.

## ship

```bash
echo "shipped"
```

## stop

```bash
echo "stopped"
```
