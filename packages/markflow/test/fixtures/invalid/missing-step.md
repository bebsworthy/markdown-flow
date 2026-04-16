# Invalid Workflow

Missing step definition for a referenced node.

# Flow

```mermaid
flowchart TD
  start --> build
  build --> deploy
```

# Steps

## start

```bash
echo "start"
```

## build

```bash
echo "build"
```
