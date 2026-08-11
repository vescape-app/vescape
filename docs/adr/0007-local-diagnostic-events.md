# Local Diagnostic Events

Native diagnostic evidence is stored locally in Room before optional PostHog transport. Alpha ride debugging showed that PostHog can miss the exact recovery path, especially long auto-reconnect scans that eventually succeed and therefore do not produce failure events. Local Diagnostic Events give the app and adb a durable, low-volume trail of connection and telemetry recovery breadcrumbs without turning every internal state change into a remote analytics event.

Superseded on the transport question by [ADR 0031](./0031-diagnostics-stay-local-only.md): PostHog is removed and the local store is the only diagnostic sink.

## Consequences

- PostHog remains useful for aggregate failures, but local Room state is the source of truth for field debugging.
- Reconnect scan breadcrumbs can be recorded locally without increasing remote event volume.
- Ride History Markers stay map-visible and user-facing; Local Diagnostic Events stay debug-facing.
