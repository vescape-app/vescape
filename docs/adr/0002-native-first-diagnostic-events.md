# Native-first Diagnostic Events

Diagnostic Events are captured native-first. Android native emits the primary events because BLE transport, telemetry persistence, and tune read/write workflows live in Kotlin. JavaScript emits only UI/view failures and avoids duplicating native failures that have already been reported.

During alpha, PostHog is the chosen transport and Diagnostic Events are always enabled. Events are anonymous by default and use device/install identity rather than a user account.

Updated by [ADR 0007](./0007-local-diagnostic-events.md): local Room persistence now records Diagnostic Events before optional PostHog transport. Superseded on the transport question by [ADR 0031](./0031-diagnostics-stay-local-only.md): PostHog is removed and diagnostics stay local-only.

## Considered Options

- **Sentry-first crash/error monitoring.** Rejected because the app needs simple handled BLE and tune diagnostics more than a full crash-monitoring workflow.
- **React Native PostHog as the primary reporter.** Rejected because JavaScript is mostly the view layer; critical failures can happen inside Kotlin before JS sees useful context.
- **Custom backend or Room-backed diagnostic upload queue.** Rejected for now because PostHog already provides an offline queue and asynchronous flush. The app can add a native-owned diagnostic queue later if alpha evidence shows events are lost before PostHog can capture them.
- **Crashlytics plus custom events.** Deferred because native crash/ANR depth is not yet the main need.

## Consequences

- Native operation boundaries report one Diagnostic Event per failed operation, such as connect, telemetry receive, config read, profile push, or ride recording failure.
- Internal Kotlin helpers should return or throw enough context for the operation boundary to report once, instead of sending multiple low-level events.
- Telemetry receive diagnostics should capture failures between BLE connection and usable Telemetry Samples, including waiting-for-telemetry timeout, stale telemetry, invalid Refloat telemetry payloads, packet reassembly drops, and parse/decode failures.
- Tune/config failures may include the raw config blob, encoded for transport, because reproducing decoder and read-patch-write failures requires the exact board bytes.
- GPS coordinates are excluded from automatic Diagnostic Events.
- JavaScript reports UI errors and caught view-layer failures only.
- If native reports a failure and then rejects a JS promise, JS should not report the same failure again.
