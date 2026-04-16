# Bad Retry Workflow

Has max:N but no :max handler.

# Flow

```mermaid
flowchart TD
  test -->|pass| done
  test -->|fail max:3| fix
  fix --> test
```

# Steps

## test

```bash
echo "test"
```

## fix

```bash
echo "fix"
```

## done

```bash
echo "done"
```
