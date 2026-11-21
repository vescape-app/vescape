# iOS background lifetime uses a When-In-Use location anchor and CoreBluetooth restoration

iOS has no foreground service, and `bluetooth-central` alone only grants brief wake-ups — it does NOT protect the process from jetsam during a ride.

- **When-In-Use location only (never `Always`):** active `CLLocationManager` with `allowsBackgroundLocationUpdates` anchors the process only while foregrounded or while riding/recording; do not request `Always` auth or significant-location-change monitoring.
- **Board Probe central MUST NOT carry a restore identifier:** `CBCentralManagerOptionRestoreIdentifierKey` belongs on the Board Session central (and separately on enrolled Accessories), never on Board Probe — probing must never resurrect the app.
- **Headless native resurrection & stale Live Activity:** a restored session resumes fully native with no JS runtime. Every Live Activity update MUST set a short `staleDate` so the widget labels itself stale when jetsammed; reap orphan activities on launch.
