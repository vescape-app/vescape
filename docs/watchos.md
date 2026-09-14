# watchOS

WatchOS requirements, platform decisions, constraints, and findings from development and device testing. Runtime behavior is still under investigation.

The watchOS Mirror targets the existing Wear OS Mirror's behavior as closely as the platform permits. The Apple Watch arriving on 2026-09-15 is an opportunity for the first physical-device tests, not a delivery deadline or a reason to reduce the target scope.

Use the repository's bidirectional `@parity` contract for equivalent implementations. Specific platform differences remain design questions until agreed; arrival of the device does not implicitly accept them. Implementation waits until the design interview reaches shared understanding.

Parity follows current Android code, not obsolete feature descriptions. Android no longer forwards alerts to the wrist; its Move and Lights interaction haptics do not constitute alert playback. Watch alert forwarding is therefore not part of this parity scope.

The rider uses the watch while the iPhone stays locked in a pocket. Lowering the wrist must preserve visible gauges with reduced-refresh updates during the ride, matching Wear OS ambient behavior as closely as watchOS permits. This is an accepted product requirement, not a verified watchOS capability; the lifecycle mechanism and physical-device validation remain unresolved.

The watchOS layout uses the full usable rectangular display rather than fitting Wear OS's circular layout inside it. Adapt the rim gauges to the display edges and use the available center area for page content, respecting rounded corners and system safe areas. Preserve the metrics, pages, and controls from Android. This intentional visual platform difference does not relax behavioral or data-contract parity.

Keep Android's swipe navigation and additionally support turning the Digital Crown, the watch's side knob, to navigate vertical pages. It is an alternative navigation input, not a replacement for touch gestures or a Board control.

The first physical test device is the rider's Apple Watch Series 6. Its installed watchOS version and case size are not yet confirmed. Implementation choices must support this device; it does not establish the minimum supported hardware for the product.

Preserve Android's rider-configurable watch refresh rate. There is no fixed battery-duration acceptance target; measure actual runtime on the physical watch and tune from those results.

The rider delegates Apple-specific implementation choices. Do not require them to choose unfamiliar APIs; investigate the mechanisms against the accepted riding behavior and report material product limitations.

## Runtime investigation, 2026-09-14

[Float Control's App Store listing](https://apps.apple.com/us/app/float-control-vesc-companion/id1590924299) confirms wrist telemetry and voice-summary commands, requires watchOS 10.2 or later, and declares background location use. It does not establish which process uses location, whether it uses workout sessions, or whether wrist-down telemetry updates continuously. Its implementation must not be inferred from its store category or the presence of watch support.

[Apple's background location guidance](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background) supports real-time navigation on watchOS. Investigate this mechanism first for Vescape's navigation behavior, without introducing fitness tracking. Location must serve an actual feature, not be a discarded stream used solely to evade suspension. Behavior when no route is active, when stationary, and when location permission is denied remains unresolved.

[WatchConnectivity](https://developer.apple.com/documentation/watchconnectivity/wcsession) offers immediate messages to reachable apps and deferred background transfers. Use immediate messages for live frames and rider commands; never substitute queued background delivery for Board Move holds. Mirror cold state through latest-state delivery, preserving independent route, settings, weather, and Board state when updating the combined context.

[Apple's Always On documentation](https://developer.apple.com/documentation/watchos-apps/designing-your-app-for-the-always-on-state/) distinguishes displaying an inactive app from continuing to execute and update it. The Series 6 display alone does not prove runtime parity. Do not mark ambient parity complete based on simulator screenshots.

## First implementation and device verification

Start with native phone-to-watch frames and lifecycle instrumentation before completing the UI. Keep durable watch source under `watch/watchos/` with reproducible config-plugin injection, following ADR-0019. Reuse the existing native iOS Board state and action owners; do not introduce a JS-dependent live path.

Verify changing frame timestamps with the phone locked, wrist raised and lowered, both with and without an active route, while moving and stationary. Check freshness after interruption and reconnection. Measure actual received and rendered cadence against the rider setting; Android currently defaults to 4 Hz active and pushes every 5 seconds in ambient mode.

Then port the remaining Android channels, controls, and rectangular UI with bidirectional parity links and matching contract fixtures. Preserve the phone-side Board Move timeout, immediate stop on release, and rejection of controls on stale state. Validate delayed and lost commands before testing motor movement.

If the runtime experiment cannot meet wrist-down behavior, record the measured limitation and revise the mechanism. Do not silently replace the agreed behavior with updates only after raising the wrist.
