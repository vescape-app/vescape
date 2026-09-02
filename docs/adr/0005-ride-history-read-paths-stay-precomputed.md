# Ride History read paths stay precomputed

Ride History and profile screens are latency-sensitive. Normal reads must load precomputed summaries from native storage and must not reconstruct raw Telemetry Samples.

## Considered Options

- **Recalculate missing derived stats during screen reads.** Rejected because replaying raw Telemetry Samples can make history/profile loads slow and unpredictable.
- **Backfill old Ride History automatically in the background.** Deferred because it needs explicit progress, cancellation, and failure handling before it is safe for large histories.
- **Compute new derived stats while recording and use fast fallback for old data.** Chosen because new Ride Recordings get accurate summaries without making existing Ride History reads expensive.

## Consequences

- History lists, ride top bars, and profile stats read bucket/session summaries only.
- Existing Ride History may keep older derived values until an explicit maintenance path exists.
- Future recalculation of old summaries must be an intentional maintenance workflow, not part of normal reads.
- Read paths must not mutate durable Ride History as a side effect unless that behavior is documented as maintenance.

## Scope

"Reconstruct" here means replaying raw **Telemetry Samples** to recompute derived values. It does not mean any join at all. Resolving a label or attribute from a small configuration table — a **Board** name from its id, a **Tune Profile** name from its id — is a bounded lookup, not a replay, and this ADR does not forbid it. ADR-0028 relies on that reading.
