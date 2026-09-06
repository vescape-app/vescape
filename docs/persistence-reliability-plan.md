# Native persistence reliability plan

Status: implementation started with #461.

## Host recording contract

`bun run test:persistence` runs one shared file-backed recording scenario on JVM Room and macOS
GRDB. Both runners load `modules/vescape-core/shared/recording-persistence-contract.json`, derive a
minute bucket from its moving samples, commit frames and bucket, close SQLite, reopen it, then assert
explicit durable values. Missing fixture/scenario fails either runner.

Android compiles the production `TelemetryRoomDatabase`, Room-generated `TelemetryDao`, recording
transaction seam, entities, and bucket builder into a plain Kotlin/JVM module. Android `Context`,
legacy-file rename, incremental migration adapters, and app lifecycle remain in `TelemetryDatabase`.
Room 2.8.4 runs through `sqlite-bundled` 2.6.2 on the host. This case opens Room's production fresh
schema; #468 will extract and execute the Android incremental migration and backup-restore paths.

macOS compiles production `TelemetryDatabase.migrator`, `RecordingPersistenceSQL`, and bucket builder
through a small Swift executable target. App-directory selection and database hot-swap remain in the
iOS adapter. The host resolves GRDB 6.29.3 because earlier 6.x SPM builds fail to import Darwin on
current Xcode; the app ships CocoaPods GRDB 6.24.1. This suite verifies SQL/schema behavior, not exact
shipping-driver binary behavior. Device lifecycle and crash durability remain device checks.

Measured on 2026-09-06: a clean `bun run test:persistence` took 11.83 s end to end (Android build
3 s, Swift build 7.28 s, macOS scenario 24 ms). A warm run took 2.87 s end to end (Android 615 ms,
Swift build 220 ms, macOS scenario 20 ms). The scenario duration excludes tool startup and builds.

## Native persistence error delivery check

Issue #462 routes recording transaction failures directly to the already initialized native Sentry
SDK (`io.sentry:sentry-android` 8.31.0 and `Sentry/HybridSDK` 8.58.0, matching
`@sentry/react-native` 7.11.0). Reports contain only operation, failure category, and exception type;
telemetry, GPS, SQL, arguments, and error descriptions are excluded. Repeated failures in one
episode produce one event. Offline delivery remains the SDK's best-effort queue.

On 2026-09-06, compile-time native integration was verified by Android and iOS test builds. An
actual event delivery check was unavailable in this checkout because no Sentry auth token or
production DSN was available. Do not treat SDK invocation tests or successful compilation as proof
that Sentry received an event. A release-device delivery check must trigger the deterministic
recording write failure, copy the returned Sentry event id, and confirm that exact event in the
production project without adding sample, location, SQL, or argument data.

## Implementation issues

- #461 — Test recording across hosts
- #462 — Surface recording storage failures
- #463 — Protect Board and settings saves
- #464 — Protect Favorite storage operations
- #465 — Protect Tune and alert storage
- #466 — Surface history read failures
- #467 — Cover remaining persistence contracts
- #468 — Verify migrations and backup restore
- #469 — Gate releases on storage contracts

## Problem

The Board-id migration removed a column from iOS telemetry inserts without removing its SQL placeholder. SQLite rejected new frame and bucket writes, and `try?` hid the failure. Commit `54c79900` corrected both statements and added executable persistence regression tests. Paging tests alone could not detect the write failure.

## Agreed direction

- Cover all Android and iOS persistence, including writes and silent read failures, delivered in stages starting with Ride Recording. Failure states, recovery behavior, error contracts, and shared test coverage must stay in parity. Implementation mechanisms may differ between Room and GRDB.
- Keep native ownership and separate Room and GRDB implementations.
- Use GRDB records for ordinary iOS writes and Room-generated entity writes on Android. Allow custom SQL for migrations and aggregate updates, with executable DB tests covering their behavior. Preserve existing merge and transaction semantics; do not replace aggregate updates with record replacement.
- Extract persistence into modules that can execute on the host without Android framework, UIKit, or Expo dependencies. Android uses Room's JVM support; Swift uses a macOS-compatible GRDB target. Platform adapters retain lifecycle and OS responsibilities.
- Test the production repositories, generated DAOs, and migrations against real local SQLite. Do not duplicate production SQL in a test-only implementation.
- Share behavioral scenarios and expected results across platforms. Compare durable values and observable outcomes, normalizing generated identities and timestamps. Require both runners to cover every shared scenario.
- Exercise transactions, updates, deletes, migration preservation, write failures, and close/reopen persistence. Use temporary database files for reopening and migration scenarios.
- Require migration fixtures for every supported DB upgrade path and Android-to-iOS and iOS-to-Android backup restore. Assert preservation of rides, Boards, settings, Favorites, and other covered durable values. Determine supported versions from production migration and restore contracts; do not invent a new support cutoff. Exercise actual backup/restore and migration code where applicable, not just fixture queries.
- Make both contract suites required release gates. Existing native CI jobs are a starting point; release dependency wiring must be verified.
- Keep device smoke tests for background recording and OS lifecycle, outside the fast host DB contract suite.
- Fail fast when a recording write transaction fails: expose a failed recording state immediately, preserve already committed data, and keep Board connection and live telemetry running. Do not add an application retry loop that silently continues claiming to record.
- After a recording transaction fails, discard the uncommitted batch and stop accepting further recording samples. Do not retain a retry buffer. Surface the interruption in live failure state and report it to Sentry; do not rely on writing an interruption marker to the same failed database. Already committed ride data remains available when storage can be read again.
- When local storage is unusable, enter App Storage Failure. Present a persistent, non-blocking warning and disable affected storage-dependent actions. Keep speed, battery, and live alerts available where their inputs remain usable. Never represent failed reads as empty history or failed writes as successful saves.
- Failed reads propagate a simple explicit error to the affected view or caller. Reuse existing error presentation. Do not add stale-data state, caching, retry UI, or a separate recovery framework for read failures. Missing rows remain distinct from failed queries.
- Keep implementation small: shared contracts and native failure handling should remove duplication, not introduce a general persistence framework or elaborate error-state hierarchy.
- Recovery guidance is to restart the app, with no in-app retry mechanism. For a known full-disk error, instruct the rider to free storage before restarting. Restart is not a promise of recovery: clear the failure only after startup storage checks succeed; programming defects may require an update. "Restart app" is guidance, not a requirement to terminate the app programmatically.
- After restart and successful storage checks, use the normal recording startup rules. Do not add a special recovery flow or reconstruct discarded samples.
- Report persistence failures to Sentry through a native platform adapter, independently of the failing application database and JS availability. Deduplicate repeated reports for the same failure episode. Include operation and sanitized error metadata, not telemetry, GPS, SQL arguments, or bound user data. Test adapter invocation as part of failure contracts; verify actual delivery separately. Offline delivery remains subject to SDK queue and network availability.

## Proposed implementation order

1. Establish one shared recording persistence scenario and extract the minimum production dependencies needed to run it on both hosts. Measure runtime and confirm the tests detect the original malformed insert.
2. Expand contract coverage while replacing fragile iOS inserts with GRDB record-based writes. Preserve aggregate merge and transaction semantics.
3. Implement the agreed failure behavior across platform peers and bridge contracts.
4. Extend across Boards, settings, Favorites, Tune data, and remaining stores; enforce scenario coverage and release gates.

## Open decisions

- Exact failure classification and startup checks: distinguish storage unavailability from an operation-specific query defect without hiding either.
- Native Sentry adapter wiring and delivery verification when the application database fails.
- Exact record mappings and inventory of custom SQL requiring behavioral tests.
- Host extraction boundaries, production SQLite driver choice, and supported migration fixtures. Host tests do not prove OS-specific SQLite behavior or crash durability.
- CI runtime budget and any device checks required for storage engine or lifecycle changes.

Existing decisions: [iOS port strategy](./adr/0011-ios-port-strategy.md), [precomputed history reads](./adr/0005-ride-history-read-paths-stay-precomputed.md), and [local diagnostics](./adr/0031-diagnostics-stay-local-only.md).
