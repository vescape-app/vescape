# Privacy Zones drop Ride Recording samples

Privacy Zones protect places such as home or work by preventing Ride Recording data from being retained while the rider is inside an enabled zone. We drop whole Telemetry Samples for future recording writes inside those zones, leaving Live State unchanged and allowing Ride History to show natural gaps instead of storing hidden coordinates or privacy markers.

## Considered Options

- **Strip only GPS data.** Rejected for the first implementation because keeping telemetry while removing location preserves metrics but makes the privacy behavior harder to explain and reason about.
- **Pause recording inside zones.** Rejected because recording state changes would add lifecycle complexity and could expose privacy-boundary timing in the UI.
- **Filter zones only in Ride History.** Rejected because durable telemetry would still contain private samples.
- **Drop whole recording samples in native persistence.** Chosen because native owns durable ride truth, the rule survives reloads/backgrounding, and gaps make the privacy effect explicit without storing zone names in rides.

## Consequences

- Privacy Zones affect Ride Recording only; live telemetry and live map behavior stay unchanged.
- Ride History may contain route and telemetry gaps when recordings pass through enabled Privacy Zones.
- Saved Privacy Zones must live in native storage so the recorder can apply them before persistence.
- Changing Privacy Zones affects future samples only and does not rewrite existing Ride History.

## Interim Ride Track scope

#448, #449, and #450 retain this policy. Reuse the existing enabled-zone geometry to drop Ride Track fixes, preserve the existing Telemetry Sample suppression, and keep live GPS consumers unchanged. Do not introduce privacy markers, continuity flags, track segment identities, or a new gap-detection mechanism for Privacy Zones.

Readers retain their existing gap checks as they move to separate telemetry and GPS streams. A short omission below those checks' thresholds may still be joined or treated as continuous for media matching; these issues do not add a guarantee that every Privacy Zone crossing creates a visible route break.

The future direction is to retain local recordings inside Privacy Zones and control sharing through prevention or warnings, together with Group Ride invisibility. Large zones motivate that rework. It requires a separate policy/design change and is outside #448, #449, #450, and #452; this amendment does not enable recording inside zones today.
