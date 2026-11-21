# Rider Signal times run on the relay clock

- **Signal and hazard times are relay epoch ms:** `startedAt` / `expiresAt` are compared only against the relay `now` carried by the latest roster, offset by the local monotonic time it arrived. NEVER compare them with the phone clock (`Date.now()`, `System.currentTimeMillis()`); phone clocks drift and riders' phones disagree.
- **Ride Notices are the one conversion point:** notices run on the phone clock, so `RiderSignalNotices` converts each signal once, with the `localNow - relayNow` offset of the roster that first carries its `startedAt` (no offset when the roster has no `now`). The conversion is pinned until `startedAt` changes, so a re-sent roster is an identical no-op post instead of jittering by network latency.
- **`revision = startedAt`:** a new kind or a re-send shows a dismissed notice again; a rename does not.
