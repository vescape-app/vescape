# Accessories

Design in progress. These are agreed requirements, not implemented behavior.

## Initial scope

- A board-mounted distance sensor controls Remote Tilt from ground clearance.
- A separate light accessory responds to Board braking telemetry.
- Enrolled accessories auto-connect when the app starts and operate through the native runtime while the screen is locked or the app is backgrounded.
- In v1, every Board-related binding targets the currently connected Board. There is no Board selector or per-Board binding configuration.
- Sensor calibration is saved once per binding. Moving the sensor to another Board or mounting position requires manual recalibration; explain this beside the calibration controls.

## Discovery and enrollment

- The existing Board selector is the accessory entry point, with separate Boards and Accessories sections and an Add accessory action alongside the existing Board management flow.
- Accessory rows show connection status and open the accessory's configuration screen. Accessories are not nested under individual Boards; bindings still use the currently connected Board.
- Evolve the spike's Settings → Sensors navigation into this flow. Compose Board and accessory domains at the screen level rather than adding hardware-domain dependencies inside Board components.
- Compatible accessories advertise a shared Vescape Accessory BLE service UUID, independent of their display names. The draft UUID is specified in [protocol v1](./accessory-protocol.md).
- After connecting, Vescape reads a manifest containing a stable accessory ID, display name, protocol version, firmware version, and capabilities.
- Each capability has a stable local ID and a recognized type. Ground-clearance inputs declare centimetres as their unit; brake-light outputs receive semantic states.
- Measurement capabilities declare supported measurement rates and numeric measurement ranges in the manifest. Vescape uses these hardware limits to validate requests; they are distinct from rider-selected near/far calibration distances.
- One accessory may expose multiple capabilities. Unknown types appear as unsupported without blocking recognized capabilities.
- Nearby accessories are added explicitly by the rider. Only saved accessories auto-connect; discovery alone never authorizes a tilt input.
- V1 supports exactly two capability types: `ground_clearance` and `brake_light`. Generic sensor support and arbitrary binding editors are out of scope.
- Recognized types provide predefined behavior and suggested settings that the rider can adjust. Keep capability-specific setup and runtime handling separate so future types can be added without redesigning discovery.
- Capability types and stable local IDs are separate: adding another type does not change existing capability identities. Protocol evolution must preserve recognized capabilities when an accessory also advertises unknown types.

## Ground-clearance sensor

- Use only the VL53L0X time-of-flight sensor for this PoC. Remove the spike's ultrasonic support when implementing the firmware changes; there is no sensor-selection UI.
- Firmware exposes one `ground_clearance` capability with readings in centimetres, independent of the underlying sensor driver.
- Calibration sets near and far distances in centimetres, correction direction, and maximum Remote Tilt input.
- Less ground clearance produces stronger correction. Mounting at the nose or tail determines the appropriate correction direction.
- Missing or stale readings and accessory connection loss use the existing smooth Remote Tilt cancellation behavior while the Board connection remains available.
- Disable sensor measurements and sensor-driven tilt while not riding, to save accessory power and prevent unwanted input. Keep BLE connected in standby so Vescape can resume measurements when riding starts. Reuse the existing native riding-state predicate after checking its implementation; standby commands are specified in protocol v1.
- Reuse existing app controls and native Remote Tilt behavior.
- The sensor accessory screen shows live distance in centimetres and lets the rider configure near/far distances, correction direction, and strength. Measurements run while this screen is open even when not riding; sensor-driven tilt remains disabled while not riding.
- The rider supplies Board-specific calibration during initial setup; firmware does not supply an assumed mounting calibration. Once configured, the binding operates automatically during riding with no separate arming step.
- Calibration edits save automatically when complete and valid, with near distance strictly below far distance. There is no Save or Apply step; a complete valid calibration activates the binding automatically for riding.
- The eventual hardware includes front and rear sensors. This PoC focuses on capability types and defers arbitration between competing tilt inputs; stable capability IDs leave room for both later.
- While a configured ground-clearance accessory is connected, the Remote Tilt pad remains visible as a read-only indicator of commanded tilt, with manual input disabled. It displays commanded input, not measured Board pitch.
- Board Move remains available while not riding, when sensor-driven tilt is inactive. Both use the existing native remote-input controller; transitions must prevent a pending sensor return from overriding Board Move.

## Wire protocol

- Use a small versioned JSON protocol for the PoC, covering the manifest, sensor readings, and app commands. [Protocol v1](./accessory-protocol.md) defines the implementation draft, including schemas and proposed defaults.
- Frame messages as newline-delimited JSON: one compact JSON object followed by `\n`. Both receivers buffer BLE chunks until a complete line arrives; BLE packet boundaries are not message boundaries.
- Enforce the protocol's fixed maximum message size and disconnect on malformed or oversized messages.
- Receivers ignore unknown optional fields within a supported protocol version. Changes to existing field meanings require a new protocol version.
- Unsupported protocol versions block operational commands and bindings. Vescape may show the discovered accessory with an incompatibility explanation, but does not activate its controls.
- Configuration requests carry a request ID. Firmware responds with a matching acknowledgement containing the settings actually applied, including the accepted measurement rate, or an explicit error. Vescape does not treat a successful BLE write as configuration acceptance.
- Sensor readings are unacknowledged streams; individual samples do not require a round trip.
- Commands set explicit desired values or states, such as measurement enabled/disabled or braking state. Do not use toggle/cycle commands: repeating a request must preserve the same result without restarting an unchanged light animation.
- Runtime commands expire unless renewed by Vescape. On expiry, sensors return to measurement standby and lights use their firmware-defined unavailable behavior. Protocol v1 proposes timeout values for PoC validation.
- Detect loss in both directions without requiring a final disconnect message: accessories detect expired app commands, and Vescape detects missing expected sensor readings. If accessory power dies, stale sensor input releases tilt through the existing smooth cancellation while the Board connection remains available.
- Keep unavailable Board telemetry distinct from an expired app command: Vescape can remain responsive while reporting that Board telemetry is unavailable.
- Every reconnect starts a fresh protocol session: read and validate the manifest again, then resend the current applicable configuration and state. Discard old queued commands and ignore acknowledgements or callbacks belonging to the previous session.
- Sensor reading messages identify their capability and carry an explicit status: `ok` with a numeric value, `out_of_range`, or `error`. Ground-clearance values are in centimetres.
- Out-of-range readings, sensor errors, and stale or missing readings release sensor-driven tilt through the existing smooth return behavior. A missing value never represents a valid maximum-distance sample.

## Brake light

- Vescape sends semantic states: riding, braking, hard braking, and not riding. Accessory firmware owns brightness, colors, and blink patterns. The initial light's intended behavior is dim red while riding, brighter red when braking, and blinking red under hard braking.
- Detect braking from decreasing Board speed magnitude over time, in either travel direction. Constant-speed riding does not activate braking, including downhill riding.
- One sensitivity control adjusts the deceleration thresholds for brighter red and hard-braking blinking. Smoothing and threshold values remain to be resolved.
- While not riding, the rider can choose between light off and a steady red glow, for example while leaving the Board outside a shop.
- Non-riding light behavior is independent of the sensor's measurement standby.
- Accessory firmware owns the visual behavior when disconnected or when Board telemetry is unavailable; Vescape does not prescribe a loading pattern or fallback color.
- Vescape owns braking detection and sensitivity; it does not stream individual LED frames.
- The light settings screen offers a parked preview of riding, braking, and hard-braking states on the actual accessory. Closing the preview restores automatic behavior.
- The accessory detects its own connection loss. While connected, Vescape explicitly reports Board telemetry unavailability. Missing app updates must also be detectable without receiving a final message.

## Remaining work

- Implement and validate the protocol draft across firmware and native app runtimes.
- Reuse native riding detection and Board telemetry freshness rules.
- Tune brake detection smoothing and sensitivity thresholds using ride data.
- Validate protocol timing defaults under concurrent Board and accessory traffic.
