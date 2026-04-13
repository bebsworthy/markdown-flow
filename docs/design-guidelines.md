# Design Guidelines

Building a tool that functions as both a high-quality library and a polished CLI is a masterclass in decoupling. To achieve clean architecture and long-term maintainability, the CLI should essentially be nothing more than a "thin client" consuming your own library.

Here are the best practices for structuring this dual-purpose project:

## Core Structural Principles

- **Decouple Core Logic from the UI:** Treat the CLI as just one "consumer" of your logic. The core functionality should have zero knowledge of terminal-specific concepts like argv, flags, or exit codes.

- **The "Library-First" Approach:** Build the entire project as a library first. If you can't perform an action via an API call in code, it shouldn't exist in the CLI.

- **Hexagonal (Ports & Adapters) Architecture:**
  - *Core:* Business logic and domain entities.
  - *Ports:* Interfaces defining how the core communicates with the outside world.
  - *Adapters:* The CLI (input adapter) and File System/Network (output adapters).

- **Strict Dependency Flow:** Dependencies should only point inwards. The library should never depend on the CLI framework (e.g., your logic shouldn't import Cobra or Click).

## Library Design (The "Engine")

- **Statelessness:** Design the library functions to be as pure as possible. Avoid global state or singletons that could make the library difficult to use in a multi-threaded or long-running application.

- **Rich Domain Objects:** Return structured data (Objects/Structs/JSON) rather than formatted strings. Let the consumer decide how to display the data.

- **Custom Error Hierarchies:** Throw or return specific, typed errors. This allows the CLI to catch a FileNotFoundError and print a pretty red message, while a programmatic user can handle it logically.

- **Configuration Injection:** Don't hardcode paths or environment variables inside the core. Pass a configuration object or use functional options during initialization.

- **Granular Exports:** Use an "Internal" vs. "Public" directory structure. Only expose what is necessary for the public API to keep the surface area small and maintainable.

## CLI Design (The "Interface")

- **Thin Wrapper Strategy:** The CLI's only jobs are:
  - Parsing command-line arguments and environment variables.
  - Mapping those inputs to library function calls.
  - Formatting the library's output for the human eye (or machine-readable JSON).
  - Managing process exit codes.

- **Output Formatting Separation:** Keep your "printers" separate. Create a formatting layer that takes library results and turns them into Tables, Progress Bars, or JSON.

- **Graceful Degradation:** Use a logging abstraction. In a library, logs might go to a file; in a CLI, they should go to stderr while the primary output goes to stdout.

- **Standard Streams:** Respect stdout for data and stderr for logs/errors. This is crucial for users who want to pipe your CLI output into other tools.

## Maintainability & Extensibility

- **Dependency Injection (DI):** Use DI to swap out components. For example, pass a FileSystem interface to your core logic so you can easily mock it in unit tests without touching the actual disk.

- **Plugin Architecture:** If you need extensibility, define "Hooks" or "Middleware" in the library. This allows users (and your CLI) to inject custom behavior into the execution flow.

- **Single Source of Truth for Metadata:** Store the version number, description, and help text in one place that both the library and the CLI distribution manifest (like package.json or Cargo.toml) can reference.

- **Comprehensive Test Suite:**
  - *Unit Tests:* Target the library logic in isolation.
  - *Integration Tests:* Target the library API.
  - *End-to-End (E2E) Tests:* Run the actual CLI binary/script against real-world scenarios to verify the UX.
