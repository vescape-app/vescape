---
name: code-review
description: Read-only code review of a diff, commit, branch, or PR without running linters or tests. Use for `/code-review` and diff reviews.
---

Read-only code review. Every finding must come from code you actually read.

## Rules

- **Do not run checks or tests.** Never run formatters, linters, typecheckers, `knip`, builds, or test suites — `lefthook` and CI own them. Skip mechanical nits they catch.
- **Read-only.** Never edit files, stage changes, or mutate git state.
- **Confirm or drop.** Read surrounding context, callers, and peers until each suspect is confirmed or cleared. No speculation, no praise, no diff recap.

## What to check

- **Durable data** (judge from the diff, never a `DB:` claim — Room, GRDB, `modules/vescape-core/schema/database.json`, `android/schemas/`, migrations, backups, `MAINTENANCE_JOBS`): if touched, read [`persistence-tests`](../persistence-tests/SKILL.md) and check upgrade safety on existing rows, atomic multi-writes, Room/GRDB/`database.json`/export parity, cross-platform backups, downgrade safety, and real-code tests wired into `persistence-jvm/build.gradle.kts` and `Package.swift` / `persistence-macos/`.
- **`@parity` peers**: read peer files across `modules/vescape-core/{ios,android}` and the TS bridge. Flag undocumented drift (`@platform-diff` / `TODO(<platform> parity)`). Report shared bugs once citing both files.
- **Bugs & repo traps**:
  - State/lifecycle bugs, missing resets, event ordering, BLE reconnect / board-switch / background races.
  - Swallowed errors returning silent fallbacks (`docs/error-handling-audit.md`).
  - VESC/Refloat safety, pushback/fault/warning paths, km/mi units, clock domains.
  - `AGENTS.md` architecture: native owns durable truth, `src/modules/` boundaries, no dead/duplicated code, `docs/board-warnings.md`, row-by-row conversions in `MAINTENANCE_JOBS` (ADR-0046/0047).
  - UI/Skia hot paths and theme tokens when touched (`docs/agents/skia.md`, `docs/agents/react.md`).
  - Tests (read, never run): happy-path only, mocks hiding the real boundary, weakened assertions, duplicated SQL/logic, or trivial predicates.

## Output

Group under **Blockers**, **Should fix**, **Decisions** (omit empty). Each item: `file:line` (`symbol`) — concrete effect + direct fix.

If clean: `No findings.` plus one line noting any non-static blind spot (e.g. hardware/device behavior).
