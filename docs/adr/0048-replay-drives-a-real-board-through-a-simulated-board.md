# Debug Recording replay drives a real Board through a Simulated Board

A replay runs an **ordinary Board Session of a chosen real Board** behind `SessionTransport` — NEVER a synthetic `replay:` board id and NEVER `isReplay` branches across features (only Debug Recording capture stays off so a replay never records itself). Replaying onto a real Board therefore writes into its history and saved config like a ride would.

- **No Session Clock:** every session uses wall clock. **Replay Warmup** prefills display-only live state backwards from playback start (no alerts, no recording), then plays at 1×. Never reintroduce a fast session clock that forces timestamp restamping across subsystems.
- **Answer by reply kind, never pair to recorded `tx`:** live request timing and XML chunk offsets differ from the original recording, and thinned fixtures omit `tx` lines. `SimulatedBoard` indexes replies by header kind and holds in-memory writes/lights; unrecorded requests time out like silent hardware.
- **Recording owns hardware identity and GPS:** transport, Link Identity, poll interval, and GPS come from the recording, and `GpsDemand` turns real phone GPS off while replay owns position.
