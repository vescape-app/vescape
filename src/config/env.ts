/**
 * Build-time environment flags, and the intent-named booleans the app should actually branch on.
 *
 * Components read the intent (`showDevControls`), never the mode (`captureMode`): what a screen
 * cares about is whether rider-facing tooling belongs on screen, not which harness happens to be
 * driving it. Adding another mode then changes one line here instead of every call site.
 *
 * The E2E flag is deliberately not mirrored here — it lives in `vescape-core`, where it reroutes
 * board/telemetry reads to `e2eFake`, and duplicating it would invite the two copies to disagree.
 */

/**
 * Screenshot capture mode: a Release build with `EXPO_PUBLIC_SCREENSHOTS=1` and `EXPO_PUBLIC_E2E`
 * unset, driven by `scripts/screenshots.ts` to produce store-ready frames from the real app.
 *
 * Deliberately independent of the E2E flag: `e2eFake` would hide the native replay session the
 * screenshots depend on. Capture mode runs the production path end to end and only suppresses
 * developer-facing chrome.
 */
export const captureMode = process.env.EXPO_PUBLIC_SCREENSHOTS === '1'

/**
 * Smoke mode: a Debug build with `EXPO_PUBLIC_SMOKE=1`, driven by `scripts/smoke.ts` through the
 * same fixture database and replayed recording the capture run uses, asserting on the screens a
 * rider actually opens instead of photographing them.
 *
 * Also independent of the E2E flag, for the same reason and one more: the point of the smoke run is
 * that telemetry, history and warnings come from the real native stack. `e2eFake` would replace
 * exactly the code under test.
 */
export const smokeMode = process.env.EXPO_PUBLIC_SMOKE === '1'

/**
 * Whether this build boots from staged fixtures — a restored database plus a replayed recording —
 * rather than from whatever a real rider has on the device.
 *
 * The two harnesses differ in what they do with the session, not in how they get one, so the
 * bootstrap and the deterministic settle markers they wait on read this rather than either mode.
 */
export const fixtureSession = captureMode || smokeMode

/**
 * Whether rider-facing developer tooling belongs on screen: the REC control, the connection status
 * pill, the REPLAY badge, the development build badge.
 *
 * All of it is diagnostic, not product — a store frame shows the ride, not the instrumentation
 * around it. Smoke keeps it: nothing is being photographed, and a run that hides the REPLAY badge
 * could not assert the session it is testing is the one it started.
 */
export const showDevControls = !captureMode

// Anything a capture run alone changes — the silenced render-rate canary — reads `captureMode`
// directly. Those are not questions about rider-facing tooling, and aliasing the flag under a
// second name would just be the same boolean wearing a hat.
