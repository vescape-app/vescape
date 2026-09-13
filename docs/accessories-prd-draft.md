# [PRD][Accessories] Accessory protocol PoC

Approved and published as [PRD #475](https://github.com/vescape-app/vescape/issues/475), with implementation issues [#476](https://github.com/vescape-app/vescape/issues/476), [#477](https://github.com/vescape-app/vescape/issues/477), [#478](https://github.com/vescape-app/vescape/issues/478), [#479](https://github.com/vescape-app/vescape/issues/479), [#480](https://github.com/vescape-app/vescape/issues/480), and [#481](https://github.com/vescape-app/vescape/issues/481). Area: `[Accessories]`, `area:accessories`. GitHub is the implementation tracker; this file preserves the reviewed proposal. Relevant slices also require changes in `vescape-app/vescape-hardware`.

## Problem Statement

Riders need custom hardware to work with Vescape while riding with the phone locked. The current sensor spike shows readings, but has no reusable accessory discovery contract, durable enrollment, ground-clearance tilt binding, or brake-light output. Firmware builders need a small protocol that separates hardware implementation from app-owned behavior.

## Solution

Introduce saved Accessories with stable, typed capabilities and a versioned JSON/BLE protocol. The PoC supports a ground-clearance sensor and a separate brake-light accessory. The rider adds an accessory once, configures its behavior on its detail screen, and it operates automatically with the currently connected Board. Native owns connections, settings, and binding execution; firmware measures sensors and renders light states.

## User Stories

1. As a rider, I want to discover compatible nearby accessories, so that I can add my hardware without knowing BLE identifiers.
2. As a rider, I want to explicitly add an accessory, so that another rider's hardware does not activate my Board controls.
3. As a rider, I want saved accessories to reconnect when Vescape starts, so that setup is not repeated each ride.
4. As a rider, I want accessories to work while the phone is locked or backgrounded, so that I can ride with the phone in my pocket.
5. As a rider, I want saved identity and settings to survive accessory reboot and app restart, so that normal power cycles need no recalibration.
6. As a rider, I want incompatible firmware and unsupported capabilities explained, so that I understand why an accessory cannot operate.
7. As a rider, I want live clearance in centimetres on the accessory screen, so that I can calibrate its actual mounting.
8. As a rider, I want near/far distances, correction direction, and strength, so that correction matches my Board and mounting position.
9. As a rider, I want valid calibration edits saved automatically, so that there is no Save or Apply workflow.
10. As a rider, I want an initially unconfigured sensor to wait for calibration, so that mounting assumptions do not command tilt.
11. As a rider, I want less ground clearance to produce stronger correction, so that the nose or tail is lifted as configured.
12. As a rider, I want sensor-driven tilt only while riding, so that parking or carrying the Board does not generate input.
13. As a rider, I want sensor measurements to stop while parked but BLE to stay connected, so that the accessory saves power and can resume promptly.
14. As a rider, I want opening the sensor screen to resume readings while parked, so that calibration does not require riding.
15. As a rider, I want missing, erroneous, or stale readings to release tilt smoothly, so that the last correction is not held indefinitely.
16. As a rider, I want the existing tilt pad to display the commanded input without accepting competing gestures, so that I can see the sensor's action.
17. As a rider, I want Board Move to remain available while not riding, so that the accessory does not remove an existing control.
18. As a rider, I want bindings to follow the current Board, so that the PoC needs no per-Board assignment workflow.
19. As a rider, I want calibration to explain when remounting requires adjustment, so that I do not assume one calibration fits every Board.
20. As a rider, I want a separate light to receive riding, braking, and hard-braking states, so that it can indicate slowdown.
21. As a rider, I want brake sensitivity to change slowdown thresholds in either travel direction, so that the light responds appropriately.
22. As a rider, I want an off/glow preference while not riding, so that the light can remain visible when parked.
23. As a rider, I want to preview the light states while parked, so that I can inspect behavior without taking a ride.
24. As a firmware builder, I want explicit telemetry-unavailable state and local command expiry, so that firmware decides how connection problems look.
25. As a rider, I want fresh-session recovery after a disconnect, so that old commands do not replay after power returns.
26. As a firmware builder, I want capability IDs, declared ranges/rates, explicit statuses, and acknowledged commands, so that integrations do not depend on sensor models or device names.
27. As a firmware builder, I want framing, compatibility, and retry rules, so that both implementations agree on behavior under partial delivery and reconnects.
28. As a firmware builder, I want future capability types to have separate handlers, so that extension does not require a general scripting engine in v1.

## Implementation Decisions

- The existing Board selector is the entry point for accessory management. Show separate Boards and Accessories sections, preserve the current Board selection/add flow, and add an Add accessory action. Accessory rows show connection status and open their configuration screen. Accessories are not nested under individual Boards and continue to target the currently connected Board. Replace the spike's Settings → Sensors entry with this flow.

- Four modules form the implementation: accessory protocol/session handling; native accessory registry and lifecycle; ground-clearance binding; brake-light binding. Capability handlers expose a small typed interface for configuration, inputs, outputs, and expiry. UI uses native snapshots and sends intents.
- Use protocol v1's custom service, newline-delimited JSON, manifest handshake, applied-value acknowledgements, explicit set commands, per-session identity, and expiring runtime commands. Its numeric timing defaults are proposed and must be validated, not presented as established hardware performance.
- Support only ground-clearance and brake-light capability types. Keep unknown types isolated. No generic sensor editor, arbitrary action graph, or firmware-generated Board calibration.
- Persist enrollment and per-capability settings natively using the existing durable storage architecture, including migration and backup contracts when those stores are affected. Do not store high-rate samples durably for this feature.
- Bind to the current Board. Calibration is per accessory capability, not per Board. Save only complete valid calibration; preserve the last valid saved value while an editor contains an incomplete value.
- Reuse established native background lifecycle and Board state/trust checks on both platforms. Do not gate accessory work on React mounts or reuse recording Idle Pause as a substitute for current riding state without verifying semantics.
- Ground-clearance firmware keeps only VL53L0X support and exposes readings in centimetres. The driver remains independent of protocol and application calibration.
- Map near clearance to configured maximum input, far clearance to neutral, and interpolate linearly with clamping. Apply explicit direction. Sensor-driven commands never bypass firmware-dependent command trust.
- Sensor reads while riding or while its detail screen needs readings. Only riding permits tilt. Invalid/stale readings cancel through existing smooth native behavior; loss of the Board link cannot guarantee delivery of neutral.
- Keep the tilt pad visible as read-only commanded input while the configured accessory is connected. Board Move remains available while parked. Cancel pending sensor return ownership before handing the shared remote-input transport to Board Move.
- Derive brake states from decreasing speed magnitude. Smooth speed-derived deceleration and use hysteresis. Select and document initial thresholds within the braking slice, then validate on hardware. Constant-speed downhill riding is not braking under this agreed definition.
- Firmware receives semantic light states and owns animations. App owns sensitivity and parked off/glow preference. Parked preview uses the same expiring command path and restores actual state on exit.
- Final front/rear hardware is anticipated through capability identity, but arbitration is deferred. The PoC must not silently allow two competing sensor bindings to write tilt concurrently; show an unsupported combination instead.
- Reuse the spike as prior art, not as proof that the new protocol or locked-screen integration works. Its code is in an open PR, not the current checkout.

## Testing Decisions

Proposed for approval: test externally observable contracts in all four modules, with shared protocol fixtures across firmware/Kotlin/Swift where practical. Avoid tests for labels, trivial predicates, or duplicated implementation formulas.

- Protocol/session tests: fragmented and concatenated JSON, limits, version handling, unknown types, duplicate requests, applied rates, expiry, and stale-session callbacks.
- Registry/lifecycle tests: save/reload settings, launch reconnect, actual measurement standby, preview demand, and current-Board changes. Extend shared persistence contracts if durable schema/operations change.
- Ground-clearance tests: calibration boundaries, direction, fresh riding/trust gates, smooth release, and Board Move handoff without a late sensor write.
- Brake tests: forward/reverse speed traces, noise/hysteresis, telemetry gaps, parked preference, preview exit, duplicate state renewal, and light fallback on lease expiry.
- Prior art includes existing Remote Tilt controller tests on both platforms, TS command/presentation ordering tests, native auto-connect gate tests, and shared persistence migration/reliability tests.
- Keep firmware output checks possible with a fake light driver until physical hardware exists. That proves state delivery, not real LED behavior. Final hardware validation is a separate human-assisted slice.

## Out of Scope

- Generic sensors, arbitrary mappings, scripting, joysticks, HUDs, powerbank monitoring, and direct accessory-to-accessory links.
- Per-Board assignment/configuration, competing front/rear tilt arbitration, cloud sync, and durable sensor history.
- Ultrasonic support and an app sensor-selection UI.
- Choosing an LED bus/model now. Physical light-driver integration waits for selected hardware.
- Production authentication guarantees. Explicit enrollment and IDs alone do not authenticate a device; the protocol draft names this remaining limitation.

## Further Notes

The design and protocol draft are the normative starting context and must be made accessible to implementation agents along with this PRD. Do not publish references that assume uncommitted local docs already exist on the default branch. Include the protocol draft in the published PRD body or a versioned published artifact until it is committed.

The code slices below are AFK with deterministic validation. The last slice is HITL because the light hardware is not selected and real concurrent BLE behavior must be measured. All cross-platform native changes carry parity links and tests appropriate to the changed contract.

## Proposed implementation slices

All titles use `[Accessories] <number> - <verb phrase>`. Each issue will include the parent reference, acceptance checklist, blocker references, and all siblings after publication. Paths below are navigation hints; PR #441 paths are explicitly marked because they are absent from the current checkout.

### 1 - Discover compatible accessories

Type: AFK. Complexity: high. Blocked by: none. Stories: 1, 6, 26–28.

Build an end-to-end protocol handshake from firmware advertisement through Android/iOS native parsing to an accessory discovery screen showing identity, capabilities, and compatibility. Adapt PR #441 as needed without merging it wholesale by assumption. Include bounded NDJSON framing and firmware manifest, but no automatic Board control. Ship protocol documentation and shared fixtures with the implementation.

Acceptance: custom service discovery works independent of name; supported/unsupported versions and capability types are distinguished; fragmented manifests work; malformed/oversized input is bounded; Kotlin/Swift and firmware agree on fixtures; no control activates from discovery.

Likely files:

- `vescape-hardware: src/main.cpp` — existing BLE service and firmware entrypoint.
- `modules/vescape-core/android/src/main/java/expo/modules/vescapecore/hardware/HardwareLink.kt` — PR #441 transport starting point.
- `modules/vescape-core/android/src/main/java/expo/modules/vescapecore/VescapeCoreModule.kt` — Android bridge.
- `modules/vescape-core/ios/VescapeCoreModule.swift` — iOS bridge.
- `modules/vescape-core/src/index.ts` — native contract types.
- `src/app/settings/sensors.tsx` — PR #441 route; keep resulting route thin and domain UI in its module.
- `docs/accessory-protocol.md` — proposed contract to implement and validate.

### 2 - Save and reconnect accessories

Type: AFK. Complexity: high. Blocked by: 1. Stories: 2–5, 18, 25.

Add explicit enrollment and native saved identity, then launch auto-connect and fresh-session restoration with visible connection state on the accessory screen. Include request IDs, applied acknowledgements, retry/lease mechanics and capability revalidation as observable session behavior. No dependency on JS liveness. Exercise a state-only accessory peer to verify app command expiry before light-specific rendering exists.

Acceptance: unknown nearby devices are never auto-enrolled; reboot preserves saved identity; changed names do not duplicate hardware; new sessions discard old queues; disconnected/failed sessions are shown accurately; state-only peers demonstrate expiry; persistent changes have migration/restore coverage where applicable.

Likely files:

- `modules/vescape-core/android/src/main/java/expo/modules/vescapecore/service/AutoConnectProvider.kt` — process launch entry.
- `modules/vescape-core/android/src/main/java/expo/modules/vescapecore/service/CoreForegroundService.kt` — native lifetime.
- `modules/vescape-core/ios/connection/VescapeLaunchSubscriber.swift` — iOS launch/restoration.
- `modules/vescape-core/ios/connection/BoardSessionController.swift` — existing lifecycle integration.
- `modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/TelemetryDatabase.kt` — existing native storage facade; inspect before choosing durable representation.
- `modules/vescape-core/ios/telemetry/TelemetryDatabase.swift` — peer storage facade.
- `src/modules/hardware/store/hardwareStore.ts` — PR #441 presentation mirror starting point.
- `vescape-hardware: src/main.cpp` — session reset and volatile runtime ownership.

### 3 - Calibrate live ground clearance

Type: AFK. Complexity: high. Blocked by: 2. Stories: 7–10, 13–14, 19, 26.

Deliver the ToF-only reading path with explicit status, accepted rates, live display, measurement standby, and automatically saved calibration. No tilt actuation in this slice. Firmware actually stops continuous measurement when demand expires; opening/closing the screen changes preview demand through native configuration.

Acceptance: readings show centimetres; invalid data never becomes maximum distance; near/far/direction/strength save when complete and valid; settings survive restart; unconfigured state is explained; leaving the screen while not riding stops measurements but preserves BLE; ultrasonic code is removed; fresh-session sampling is covered.

Likely files:

- `vescape-hardware: src/main.cpp` — sensor driver, measurements, and command application.
- `vescape-hardware: platformio.ini` — existing firmware build/library configuration.
- `modules/vescape-core/android/src/main/java/expo/modules/vescapecore/hardware/SensorLog.kt` — PR #441 numeric buffering prior art.
- `modules/vescape-core/android/src/main/java/expo/modules/vescapecore/hardware/SensorReadings.kt` — PR #441 missing-value behavior to replace.
- `modules/vescape-core/ios/VescapeCoreModule.swift` — peer native bridge for new reading/settings contract.
- `src/modules/hardware/hooks/useSensors.ts` — PR #441 reading presentation starting point.
- `src/app/settings/sensors.tsx` — PR #441 screen starting point.
- `docs/accessories.md` — calibration/standby behavior.

### 4 - Apply ground-clearance tilt

Type: AFK. Complexity: high. Blocked by: 3. Stories: 11–12, 15–18.

Connect valid calibrated readings to native Remote Tilt while riding with trusted Board state. Render commanded tilt read-only using existing UI, preserve Board Move while parked, and cancel smoothly on sensor failure. This slice includes native integration on both platforms and ownership regression coverage.

Acceptance: linear/clamped direction-aware correction follows readings; missing/stale/error/out-of-range data releases input; untrusted/stale/not-riding Board state blocks sensor commands; manual pad is read-only; Board Move is not overwritten by pending sensor decay; changing Boards invalidates old writes; unsupported competing sensor inputs cannot race.

Likely files:

- `modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt` — trusted tilt methods and Board Move integration.
- `modules/vescape-core/ios/connection/BoardSessionController.swift` — peer command ownership.
- `modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RemoteTiltController.kt` — existing hold/cancel/return.
- `modules/vescape-core/ios/RemoteTiltController.swift` — peer controller.
- `src/modules/board/components/RemoteTiltPad.tsx` — read-only presentation variant.
- `src/modules/board/hooks/useRemoteTiltControl.ts` — existing native state adapter.
- `src/screens/showcase/board/RemoteTiltPadShowcase.tsx` — required variant preview.
- `modules/vescape-core/android/src/test/java/expo/modules/vescapecore/RemoteTiltControllerTest.kt` — behavior test prior art; inspect Swift peer too.

### 5 - Drive brake-light states

Type: AFK. Complexity: high. Blocked by: 2. Stories: 20–24, 26.

Deliver speed-derived native braking through acknowledged state messages into the separate firmware light capability, plus sensitivity, parked preference, and actual protocol preview in the app. Use a fake output driver in automated tests until LED hardware is chosen. Firmware rendering stays replaceable behind the state receiver.

Acceptance: forward/reverse deceleration traces produce normal/braking/hard-braking states; constant speed does not indicate braking; gaps clear detector history and send unavailable; sensitivity and parked preference persist automatically; preview restores automatic state; renewals do not restart animation; expired app commands trigger firmware fallback. Document initial filtering and thresholds as PoC defaults.

Likely files:

- `modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescTelemetryModels.kt` — available speed and Board state.
- `modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardSessionController.kt` — native telemetry consumer wiring.
- `modules/vescape-core/ios/connection/BoardSessionController.swift` — peer wiring.
- `modules/vescape-core/src/index.ts` — settings/status bridge contract.
- `src/app/settings/sensors.tsx` — PR #441 navigation starting point for accessory detail UI.
- `vescape-hardware: src/main.cpp` — current firmware entrypoint to split by capability.
- `docs/accessory-protocol.md` — semantic output and preview rules.

### 6 - Validate connected riding

Type: HITL. Complexity: high. Blocked by: 4, 5. Stories: 4, 11–17, 20–25.

Choose and connect the physical light driver when hardware exists, then verify the complete sensor + Board + light flow in current Android/iOS development builds. Start with controlled stationary checks, then rider-assisted measurements. Tune documented PoC timings/thresholds from evidence. This is the hardware-completion boundary; fake output tests do not satisfy it.

Acceptance: confirm current workspace firmware and app builds; observe real light states and preview; locked-screen concurrent BLE operation is measured; sensor and app power-loss cases produce expected fallback; Board Move handoff behaves correctly; record measured sampling/latency and remaining limits; no claims based on stale installed bundles.

Likely files:

- `vescape-hardware: src/main.cpp` — real light driver integration.
- `vescape-hardware: platformio.ini` — chosen driver's build configuration if needed.
- `vescape-hardware: docs/hardware.md` — actual wiring and measured configuration.
- `vescape-hardware: docs/flashing.md` — established upload procedure.
- `docs/accessory-protocol.md` — validated timings and failure evidence.
- `docs/accessories.md` — final PoC behavior and limitations.
- `docs/connectionState.md` — existing lifecycle expectations.
