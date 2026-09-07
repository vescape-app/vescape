# Diagnostics Stay Local Only

Diagnostic Events have no remote analytics transport. PostHog is removed from the app, the native modules, and the release pipeline; Local Diagnostic Events ([ADR 0007](./0007-local-diagnostic-events.md)) in the telemetry store are the only diagnostic sink, and Sentry owns crash and error monitoring.

The PostHog transport never carried its weight. Android read its API key from a manifest meta-data entry no config plugin ever wrote, so the sink was a no-op in every build ever shipped; iOS never had a transport at all. Field debugging already ran on the local Room trail and adb, which [ADR 0007](./0007-local-diagnostic-events.md) had made the source of truth.

## Consequences

- One diagnostic path on both platforms. `DiagnosticsRecorder` fans out to a local sink only, and the `@platform-diff` notes that documented the missing iOS transport are gone — the recorders are true parity peers now.
- `DiagnosticStatus` drops `enabled`, `host`, and `distinctId`; capture counters remain for the settings status panel.
- No remote Diagnostic Event stream. Sentry receives crashes and unexpected operation failures through explicit error-reporting owners; routine lifecycle events remain in the local trail.
- Adding remote analytics later means a new transport decision, not restoring this one.

## Error reporting clarification

The error-handling audit extends explicit Sentry reporting to unexpected storage, secure-store,
filesystem, bundled-resource, and UI integration failures. This does not add a remote sink to
`DiagnosticsRecorder`. Native reports native failures; JS shows their outcome without duplicating
the report. JS reports failures it owns separately.

Reports use fixed operation/category identifiers and error type/code, exclude raw credentials,
locations, file contents, URLs, and error messages, and deduplicate repeated failures per operation
within the process. Expected cancellation, offline results, permission denial, and unsupported
capabilities retain explicit domain outcomes. They do not become Sentry errors merely because
they pass through a catch. See the [error-handling audit](../error-handling-audit.md).
