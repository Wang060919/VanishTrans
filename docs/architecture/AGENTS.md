# Architecture documentation rules

Project rules and the Tauri command catalog are maintained only in [the root AGENTS.md](../../AGENTS.md).

- Keep [ARCHITECTURE.md](ARCHITECTURE.md) aligned with executable code and current module ownership.
- Label old refactoring reports as historical; do not present their counts, paths or test results as current.
- When moving modules, update the current architecture and run `pnpm check:architecture` and `pnpm check:commands`.
