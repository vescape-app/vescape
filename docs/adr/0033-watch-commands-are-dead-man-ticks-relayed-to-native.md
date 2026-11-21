# Watch Mirrors are injected native companions with dead-man motion commands

Wear OS (`watch/wearos/`) and watchOS (`watch/watchos/`) are standalone native companion targets injected into gitignored `android/`/`ios/` on `prebuild`.

- **Never place watch apps under `modules/` or use legacy `wearApp`:** Expo autolinking scans `modules/` for phone libraries, and Play Store ships separate phone and Wear AABs on independent tracks. Because phone and watch update independently, gate new wrist protocol features (such as wake-level push gating) on declared capabilities so older watch builds do not go blank.
- **Never use `DataClient` (or JS) for telemetry streams or motion commands:** JS is suspended mid-ride, and `DataClient` persists/coalesces updates — it corrupts streaming and can deliver a stale Board Move hold late. Use native `MessageClient` / `WatchConnectivity` messages only.
- **Motion holds MUST use repeated dead-man ticks, never press/release pairs:** a dropped wireless release would leave `BoardMoveController` rolling the board indefinitely. Relay commands into the single native phone action with direction only (`-1/0/1`); strength stays on the phone so an older watch build cannot exceed the rider's limit.
