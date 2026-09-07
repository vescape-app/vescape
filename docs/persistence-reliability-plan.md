# Native persistence reliability plan

Status: host contracts and mandatory release gates implemented through #469.

## Host recording contract

`bun run test:persistence` runs one shared file-backed recording scenario on JVM Room and macOS
GRDB. Both runners load `modules/vescape-core/shared/recording-persistence-contract.json`, derive a
minute bucket from its moving samples, commit frames and bucket, close SQLite, reopen it, then assert
explicit durable values. Missing fixture/scenario fails either runner.

Android compiles the production `TelemetryRoomDatabase`, Room-generated `TelemetryDao`, recording
transaction seam, entities, bucket builder, and `TelemetryMigrations` graph into a plain Kotlin/JVM
module. Android `Context`, legacy-file rename, the `SupportSQLiteDatabase` adapter, and app lifecycle
remain in `TelemetryDatabase`; every adapter delegates to the same portable migration step that the
Room 2.8.4 `sqlite-bundled` 2.6.2 host executes. The migration matrix starts from the authentic Room
v3 entities at `f51663a8^`, derives each graph generation with production edges, separately covers
the released v22 Tune Profile shape at `10deb46c^`, and lets Room validate every supported result
against its generated current schema. `shared/migration-fixture-manifest.json` enumerates the exact
Room versions and GRDB identifiers; versions 37–39 are absent because production jumps 36→40.

The GRDB matrix likewise stops at every registered migration prefix, seeds the durable tables and
columns available in that generation, then runs the real remaining migrator and checks the final
ledger and preserved values. It separately reconstructs the original `db6e9b9` v1 shape with global
alerts and legacy telemetry fault columns. The v27 migration intentionally drops those unowned
global rules; Board-linked telemetry survives both the v40 rebuild and v42 identity migration.

Backup support distinguishes native database upgrades from archives that production could create.
Room retains native upgrade paths from v3, while Android backup export first shipped at v14 in
`dc985d80`; Android archives therefore start at v14. The iOS restore runs the production-equivalent
Room 14→22 transformations before entering the shared numbered GRDB migrations, preserving the
older Tune Profile, Board settings, Ride Recording, battery, and GPS shapes. iOS backup export first
shipped in `23c0be34`; its original manifest generation is resolved from the exact GRDB ledger.

`bun run test:persistence` exchanges actual ZIP artifacts between the host engines in both
directions. A Room-created current archive and an authentic Room v14 archive pass through the Swift
production archive validator and GRDB migrator; a GRDB-created archive passes through the Kotlin
production codec, iOS-schema reconciliation, and Room's generated schema validator. The receiving
engine checks Ride Recording, Boards, settings, Tune Profiles, Favorites, and config values. Invalid
formats, unsupported versions, migration failures, and failed file swaps are rejected before the
former database and its WAL/SHM recovery files are discarded.

macOS compiles production `TelemetryDatabase.migrator`, `RecordingPersistenceSQL`, and bucket builder
through a small Swift executable target. App-directory selection and database hot-swap remain in the
iOS adapter. The host resolves GRDB 6.29.3 because earlier 6.x SPM builds fail to import Darwin on
current Xcode; the app ships CocoaPods GRDB 6.24.1. This suite verifies SQL/schema behavior, not exact
shipping-driver binary behavior. Device lifecycle and crash durability remain device checks.

Measured on 2026-09-07 after the release gate landed: a clean tracked-only checkout with no generated
native folders took 25.83 s end to end (Android compilation 6 s and Swift compilation 9.01 s). A
warm run took 6.37 s (Android 2 s and Swift 230 ms); host scenario assertions took 458–466 ms. Times
include orchestration and exclude a first Gradle distribution download.

## CI and release gate

`bun run test:persistence` is the only aggregate gate command. It must run on macOS with JDK 17 so
one invocation can execute Room, GRDB, Android-to-iOS archive import, and iOS-to-Android archive
import. `test:persistence:android` and `test:persistence:ios` remain useful focused commands, but
neither is release evidence by itself. The JVM runner has its own tracked Gradle wrapper pinned to
Gradle 9.3.1 and its published SHA-256 checksum, so a clean checkout needs no generated `android/`
folder, Android SDK, emulator, or Expo prebuild.

CI runs the aggregate gate unconditionally. Both internal release workflows call the same reusable
macOS job against `inputs.source_sha`, validate that the input is a 40-character commit and that the
checkout HEAD is exactly equal, and make the first build/upload job depend on its success. The gate
requires the migration manifest and both archive-exchange phases, then invokes
`scripts/test-persistence.ts` directly; an older source whose package alias ran only independent host
suites cannot pass and gain a cross-archive attestation. GitHub branch protection and repository
rulesets were inspected on 2026-09-07 and neither currently adds a separate required check; the
release workflow dependency is therefore the mandatory publishing boundary.

Successful internal manifests attest the exact tested source plus `androidRoom`, `iosGrdb`, and
`crossPlatformArchives`. Open and production promotion validate every field before credentials are
prepared or store state can change. Missing legacy attestations fail closed. Status-only production
reads keep using an already attested internal manifest and do not rerun the hosts.

The shared fixture owners are the production persistence peers under
`modules/vescape-core/android`, `modules/vescape-core/ios`, and their host runners. Any change to a
shared JSON scenario or `migration-fixture-manifest.json` must remain executable by both hosts. Room
native upgrades are supported from v3, Android-created backup archives from v14, and iOS archives
from the original GRDB ledger generation; current archives must continue restoring in both
directions. Add every newly supported released generation to the fixture manifest and both host
matrices in the same change. Device lifecycle, background execution, crash durability, the shipping
GRDB 6.24.1 binary, and actual Sentry delivery remain separate device checks.

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

## History read contract

Issue #466 extends `bun run test:persistence` with the shared
`modules/vescape-core/shared/history-read-contract.json` scenario. Both real databases execute the
production Ride History and Profile stats read paths against an empty database, a two-bucket current
ride plus a gap-separated older ride, and a deterministically broken bucket table. The runners assert
the same paging, timing, distance, speed, duration, and month results; a query failure must throw
instead of becoming a valid empty result.

Native bridge adapters reject failed history reads and report one sanitized Sentry event per read
operation with `query_failed`. Read failures do not enter Ride Recording failure state or close its
write gate. JS clears previously loaded history/profile values and uses the existing error surfaces;
recovery guidance remains an app restart.

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
- The current iOS schema now declares `vesc_fault_capture_samples.id` as `NOT NULL`, matching Room's generated schema. This corrects fresh-database metadata without a new GRDB migration: existing iOS databases already use the column as an integer primary key and remain valid to GRDB, while Android restore normalization rebuilds archived iOS copies into Room's stricter shape and preserves their rows.
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
