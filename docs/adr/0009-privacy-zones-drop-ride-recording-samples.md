# Privacy Zones drop Ride Recording data on write

Inside an enabled Privacy Zone, native drops whole Telemetry Samples and Ride Track fixes before persistence — never store hidden coordinates, privacy markers, or continuity flags, and never pause recording (pausing leaks zone-boundary timing in the UI, unlike Idle Pause which has no secret to hide). Live State and live map stay unaffected, and changing zones never rewrites existing Ride History.

**Rider Signal / Ride Hazard exception:** sending a signal or hazard is an explicit opt-in to share that spot, so its one-shot location leaves the phone even inside a Privacy Zone (or while zones are loading), while Rider Presence and Ride Recording keep dropping.
