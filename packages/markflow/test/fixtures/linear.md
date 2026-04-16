# Simple Pipeline

A basic linear workflow for testing.

# Flow

```mermaid
flowchart TD
  setup --> build
  build --> report
```

# Steps

## setup

```bash
echo "Setting up workspace"
```

## build

```bash
echo "Building project"
```

## report

```bash
echo "Build complete"
```
