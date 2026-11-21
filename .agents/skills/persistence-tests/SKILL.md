---
name: persistence-tests
description: Maintain Vescape's native SQLite persistence contracts, shared fixtures, migration tests, and cross-platform backup tests. Use when changing durable DB operations, schemas, migrations, or backup formats, or when debugging test:persistence. Device smoke tests and security-store tests are separate workflows.
---

# Persistence tests

Keep the changed operation covered by real Room and GRDB code. Stay within the requested change;
record unrelated discoveries separately rather than expanding into another audit.

## Find the contract

Paths below are relative to the repository root. Inspect the shared fixtures under
`modules/vescape-core/shared/` (`recording-persistence-contract.json`, `history-read-contract.json`,
`migration-fixture-manifest.json`, `ride-export-contract.json`, `accessory-persistence-contract.json`,
`alert-preset-contract.json`, `bucket-route-preview-contract.json`, etc.) and both platform
implementations linked by `@parity`.

- Android contracts: `modules/vescape-core/persistence-jvm/src/test/kotlin/expo/modules/vescapecore/` — `database/` for schema, migration, and backup tests; `telemetry/` for the stores.
- Swift contracts: `modules/vescape-core/persistence-macos/main.swift`.
- Orchestration: `scripts/test-persistence.ts`.

Use the existing scenario when it fits. Shared fixture values express the common contract; each
platform must execute its production persistence path. Avoid a duplicate test DAO or copied SQL
that can pass while the app's implementation breaks.

### Durable invariants & platform hazards

- **Upgrade & archive cutoffs**: Room native upgrades are supported from v3 (versions 37–39 never shipped; Room jumps 36→40), Android backup archives from v14, and iOS archives from the original GRDB ledger generation. Keep `shared/migration-fixture-manifest.json` and both host matrices updated with every newly released generation.
- **Android mixed-driver hazard**: Live Room uses `sqlite-bundled` 2.6.2 with WAL. Framework SQLite may open only legacy, staged, or closed restored files — never alongside the bundled engine on the live DB. Export holds a deferred reader transaction across keyset pages and shares a mutex with restore (recording writes never take this mutex); backup `VACUUM INTO` uses Room's writer outside a transaction.
- **Swift host vs shipping pod**: The macOS host resolves GRDB 6.29.3 while the app ships CocoaPods GRDB 6.24.1; host tests prove SQL/schema contracts, not shipping-binary crash durability.
- **Failure semantics**: Recording write failures fail fast — discard the uncommitted batch, stop accepting recording samples, keep BLE/live gauges/in-memory alerts running, and report once per episode to native Sentry without SQL, args, telemetry, or GPS. Storage unavailability (full disk, corruption, I/O, cannot-open, read-only) enters App Storage Failure until a startup transactional create/write/drop probe succeeds; ordinary query failures reject only that operation. Recovery guidance is app restart (free storage first if full disk), no retry loop.

## Extend the changed behavior

A new Room version needs its regenerated `android/schemas/…/<version>.json` committed; the
matrix fails without it. Write each new Android migration case as its own named test: create the
old version from its export (`migrateFromExport` / `createFromExport`), seed rows in that version's
shape, and assert after Room validates the current schema. Never hand-write `CREATE TABLE` SQL for
an old version; every shipped version already has an export.

Every schema change also updates `modules/vescape-core/schema/database.json` by hand. Both
platforms compare their fresh, migrated, and restored databases with it, so a column, default,
or index added on one side only fails `test:persistence`.

Choose assertions that demonstrate the actual risk: save/close/reopen, query ordering or paging,
failed read versus empty result, preserved old values, or rollback of a multi-write operation.
For rollback, fail after an earlier write inside the transaction and verify that no partial state
survives. Use disposable test databases and fixtures, never an installed app's data.

Keep intentional platform differences explicit; do not weaken one platform's expectations to make both
green. Filesystem, credential, bridge, and lifecycle behavior may need platform tests outside these
SQLite hosts.

### When adding or moving production files

Host inclusion is selective, not automatic. Paths in this subsection are within `modules/vescape-core/`:

- Android: inspect the production source list in `persistence-jvm/build.gradle.kts`. The build copies
  those files and generates the real Room DAO through KSP. Change the source list, not generated output.
- Swift: inspect the symlinks in `persistence-macos/` and the executable target in `Package.swift`.
  Link the production file; avoid maintaining a second implementation in the host runner.

### When changing migrations or backups

Inspect `modules/vescape-core/shared/migration-fixture-manifest.json`, the production Room migration graph, and the GRDB
migration registry. Extend applicable starting-version scenarios and verify seeded values after
upgrade. Preserve authentic historical fixtures; do not rewrite old input into today's schema.
Unsupported inputs should fail without replacing the installed data.

Backup compatibility requires real archives exchanged between implementations. Merely setting a
manifest's platform label does not test portability. Preserve both directions of the orchestrator.

## Run efficiently

From the repo root, use a focused Android test while iterating, substituting the actual class/method:

```sh
./modules/vescape-core/persistence-jvm/gradlew -p modules/vescape-core/persistence-jvm test --tests 'fully.qualified.TestClass.testMethod'
```

The Swift host is one assertion-driven executable, not an XCTest suite with a per-method filter:

```sh
bun run test:persistence:ios
```

After changes to a persistence contract, migration, or archive path, run the complete command once:

```sh
bun run test:persistence
```

It runs Android contracts/export → Swift contracts/import/export → the focused Android import test.
Individual host runs do not prove archive exchange. The complete command needs macOS with Swift
tooling, Java 17, and Bun; it does not boot an emulator. Dependency/build caches are useful, but keep
the Gradle test-result reuse disabled because the exchange directory changes on each run.

If a check fails, rerun the failing stage while diagnosing; rerun the complete exchange after an
archive-related fix. Fix environment problems outside project code. Do not add extra full-suite
runs for documentation-only changes.

## Report precisely

Report the operation/scenario changed, platforms exercised, exact commands and results, and any
unverified boundary. CI's reusable `.github/workflows/persistence-contracts.yml` checks an immutable
source SHA; an older green run is not evidence for new code.

Do not equate test count with coverage percentage, close/reopen with a process crash, or host success
with a passing app smoke test. Specific boundaries that host contracts cannot prove:

- **Swift host vs shipping pod**: inspect `modules/vescape-core/Package.swift` vs its podspec when GRDB version differences matter.
- **Export & bridge**: native bridge wiring, OS share-sheet behavior, and external GPX/CSV/Floaty importer compatibility require device/rider verification.
- **Native Sentry delivery**: compile checks and SDK invocation tests do not prove Sentry received an event. A release-device delivery check must trigger a deterministic recording write failure and confirm that exact event id in production without SQL, args, telemetry, or GPS data.

For current-bundle app integration, use the separate smoke/E2E workflow described in [e2e/README.md](../../../e2e/README.md).
