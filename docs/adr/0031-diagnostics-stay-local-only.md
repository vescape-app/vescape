# Diagnostics Stay Local Only

Diagnostic Events have no remote analytics transport. PostHog is removed from the app, the native modules, and the release pipeline; Local Diagnostic Events ([ADR 0007](./0007-local-diagnostic-events.md)) in the telemetry store are the only diagnostic sink, and Sentry owns crash and error monitoring.

The PostHog transport never carried its weight. Android read its API key from a manifest meta-data entry no config plugin ever wrote, so the sink was a no-op in every build ever shipped; iOS never had a transport at all. Field debugging already ran on the local Room trail and adb, which [ADR 0007](./0007-local-diagnostic-events.md) had made the source of truth.

## Consequences

- One diagnostic path on both platforms. `DiagnosticsRecorder` fans out to a local sink only, and the `@platform-diff` notes that documented the missing iOS transport are gone — the recorders are true parity peers now.
- `DiagnosticStatus` drops `enabled`, `host`, and `distinctId`; capture counters remain for the settings status panel.
- No aggregate failure analytics. Crash-shaped failures go to Sentry; anything else needs a device and its local event trail.
- Adding remote analytics later means a new transport decision, not restoring this one.
