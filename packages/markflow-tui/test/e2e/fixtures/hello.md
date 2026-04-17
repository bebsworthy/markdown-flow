# Hello Pipeline

Trivial three-step workflow used by the Journey 1 e2e test.

# Flow

```mermaid
flowchart TD
  build --> test
  test --> pack
```

# Steps

## build

```bash
echo "build ok"
```

## test

```bash
echo "test ok"
```

## pack

```bash
echo "pack ok"
```
