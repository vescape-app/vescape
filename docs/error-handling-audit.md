# Error handling audit

Status: audit implemented; Android XML parser regression corrected and verified on a real board.

The audit covers production TypeScript, Swift, Kotlin, and Wear code. It includes empty catches,
Swift `try?`, `runCatching` fallbacks, failed reads represented as missing data, and promises whose
callers discard rejection. Generated native folders, dependencies, and test fixtures are excluded.

## Required behavior

- A failed durable write must not update the UI as if it succeeded.
- A failed read must remain distinguishable from an absent value or an empty collection.
- Preserve installed privacy rules and valid state when refresh fails. Never replace them with
  permissive defaults because storage is unavailable.
- Unexpected failures have an explicit reporting owner. Native persistence uses its existing
  Sentry reporter; UI callers expose the failure without reporting it again.
- Local Diagnostic Events remain local under ADR 0031. Calling `reportUiError` alone currently
  creates a local event; it is not evidence that Sentry received the error.
- Expected cancellation, permission denial, and capability absence are normal outcomes. Handle
  them explicitly. Cleanup may preserve an earlier error, but must not overwrite its cause or
  claim a requested deletion succeeded.
- An intentionally suppressed error needs a nearby explanation identifying its outcome or the
  owner that already handled it. A comment saying "ignore errors" is not sufficient.

## Findings and work list

| Area                                      | Failure found                                                                 | Required correction                                                                 | Status                             |
| ----------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------- |
| DB startup                                | Storage warning without a Sentry report                                       | Report the startup failure once, independently of the DB                            | Fixed; final checks pass           |
| Legacy DB filename migration              | Failed checkpoint/rename permits opening a new empty DB                       | Abort opening the new DB; preserve the original and report startup failure          | Fixed; final checks pass           |
| Recording settings and privacy            | Android substitutes defaults or empty privacy zones after failed reads        | Explicit failure; preserve privacy and avoid starting with unverified configuration | Fixed; final checks pass           |
| Group Ride privacy                        | Failed zone reload can clear installed privacy rules                          | Preserve prior rules and report failed refresh                                      | Fixed; final checks pass           |
| Navigation and live Board reads           | Missing reporting or unsuccessful persistence looks successful                | Explicit operation errors and preserved valid state                                 | Fixed; final checks pass           |
| DB size                                   | Metadata failure appears as zero or indefinite loading                        | Distinguish absence, loading, and failure                                           | Fixed; final checks pass           |
| Settings and rider identity               | Discarded writes; rider load marks failure as loaded                          | Persist before success and expose errors at the owning UI                           | Fixed; final checks pass           |
| Board config, warnings, faults            | Failed reads look absent; dismissals discard errors                           | Explicit read/mutation error state                                                  | Fixed; final checks pass           |
| Alerts and Tune                           | Error hidden behind form; rollback may navigate after failure                 | Keep unfinished UI open and display the actual failed operation                     | Fixed; final checks pass           |
| Links, release acknowledgement, overlays  | Discarded action/measurement failures                                         | Visible action error or explicit fallback with reporting                            | Fixed; final checks pass           |
| Credentials                               | Keychain/Keystore errors look like missing credentials; ignored expiry writes | Distinguish absence from failure and report without credential contents             | Fixed; final checks pass           |
| Audio alerts                              | Audio session/start/decode failures can degrade to silence without reporting  | Report at the audio owner without flooding repeated playback                        | Fixed; final checks pass           |
| Group Ride socket sends                   | Failed send result discarded                                                  | Existing error/reconnect path owns the failed send                                  | Fixed; final checks pass           |
| Favorite media and debug recordings       | Requested deletion or creation can fail silently                              | Explicit filesystem outcome; preserve primary failures during cleanup               | Fixed; final checks pass           |
| Bundled Legal Policy catalog              | Missing/corrupt required asset becomes an empty catalog                       | Report the packaging invariant failure                                              | Fixed; final checks pass           |
| Legal Policy refresh                      | Failed catalog/geocoder lookup can clear a valid stored policy                | Preserve saved policy unless a jurisdiction was actually resolved                   | Fixed; final checks pass           |
| Telemetry bridge buffers                  | Allocation failure can return empty bytes with a nonzero row count            | Reject construction failure; never emit an inconsistent payload                     | Fixed; final checks pass           |
| Bundled SOC data and invariant JSON       | Missing resources and serialization failures become silent empty values       | Report invalid bundled data; reject invalid durable serialization                   | Fixed; final checks pass           |
| XML parsing                               | Swallowed parser configuration failure hides an unenforced security setting   | Enforce the same entity/DOCTYPE contract on both platforms                          | Fixed; final checks pass           |
| Wear link probes and ongoing notification | Probe failure means "no phone"; notification failure ignored                  | Preserve prior state and emit the existing Wear diagnostic                          | Fixed; final checks pass           |
| Screenshot upload tooling                 | PR lookup failure can trigger screenshot release deletion                     | Delete only after a confirmed closed/merged PR                                      | Fixed; final checks pass           |
| Prevention                                | New empty catches are easy to introduce                                       | Automated checks plus documented intentional outcomes                               | Guard and scanner regressions pass |

## Verification

Use targeted failure-injection tests at the real operation boundary. Assert the outcome, preserved
data/state, and reporting count. Do not test only that a logger was called. Native changes must
inspect the opposite platform and maintain `@parity` links.

Static checks can reject unexplained suppression patterns. They cannot prove that every fallback
is semantically safe; new persistence, privacy, and lifecycle changes still require review and
behavior tests. Device delivery to Sentry and OS-specific failures remain separate verification.

## Validation results

### Android linking regression found after the audit

Commit `e1195706` made SAX external-entity feature settings mandatory in the Refloat DOM parser.
The desktop JVM accepts those settings; Android's provider rejects them. Valid board schemas then
failed with `UNSUPPORTED_SCHEMA`, and linking waited 30 seconds for config values that could never
be saved. The correction keeps the DOCTYPE rejection and uses a rejecting entity resolver instead
of unsupported feature settings. iOS uses `XMLParser.shouldResolveExternalEntities = false` and does
not make those SAX calls.

`RefloatConfigSchemaDeviceTest` exercises the production parser on Android, including valid schema
decoding and rejection of external-entity declarations. Its valid-schema case reproduced the exact
device error before the fix. Run it on a connected Android device or emulator:

```sh
cd android
./gradlew :vescape-core:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=expo.modules.vescapecore.config.RefloatConfigSchemaDeviceTest
```

After the fix, both instrumentation tests passed on a Pixel 9 Pro XL running Android 17.
The six desktop schema tests and two Thor301 config replay tests also passed.
The rebuilt DEV APK was installed on that phone; the rider confirmed Thor301 re-link passed.
Device logs show Refloat acquisition advancing to motor config in about six seconds, with
196 motor-config fields decoded, instead of the previous 30-second Refloat timeout.

This instrumentation test is separate from the desktop native suites and is not currently wired
into CI. E2E linking uses `e2eFake.finalizeBoardLink`, so passing those flows does not verify native
schema parsing or real-board linking. Host persistence contracts cannot cover this platform XML
provider difference either.

### Earlier audit verification

- TypeScript checks and lint pass. Lint retains existing warnings.
- Full Bun suite: 966 tests pass, including scanner regressions.
- iOS native suite: 587 tests pass.
- Android native suite: 758 tests pass.
- Real Room/GRDB persistence contracts pass, including cross-platform archive exchange.
- Wear compilation and unit tests passed during the native pass.

Failure regressions cover credentials and rollback, privacy refresh, legacy migration, required
JSON preserving existing rows, recorder shutdown after a write failure, SOC catalog failure,
Legal Policy outcomes, UI write ordering, stale reads, and Board Lights session invalidation.
Socket failure/reconnect and native Favorite partial cleanup were reviewed and compiled; this pass
did not add dedicated injected failure tests for those two native paths. The Favorite UI partial
outcome is tested. Audio reporting uses the tested shared deduplicating reporter; OS audio failure
injection was not added. Device lifecycle behavior and delivery of real production events to Sentry
were not verified by these local tests.

The suppression check runs in the normal Bun suite. Intentional cases use an actual nearby
`// intentional-suppression: <reason or reporting owner>` comment. It covers common TypeScript
promise no-op/default handlers, Swift `try?` and empty catches, and Kotlin `runCatching` and empty
catches. It is a syntax check, not proof that every nonempty handler handles failures correctly.
