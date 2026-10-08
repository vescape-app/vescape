/**
 * Build-time environment flags, and the intent-named booleans the app should actually branch on.
 *
 * Components read the intent (`showDevControls`), never the mode (`captureMode`): what a screen
 * cares about is whether diagnostic tooling belongs on screen, not which harness happens to be
 * driving it. Adding another mode then changes one line here instead of every call site.
 *
 * The E2E flag is deliberately not mirrored here — it lives in `vescape-core`, where it reroutes
 * board/telemetry reads to `e2eFake`, and duplicating it would invite the two copies to disagree.
 */

/** Video capture warms the native replay off-camera and uses dark appearance. */
export const previewMode = process.env.EXPO_PUBLIC_PREVIEW === '1'

/**
 * Screenshot or video capture: a Release build with `EXPO_PUBLIC_SCREENSHOTS=1` or
 * `EXPO_PUBLIC_PREVIEW=1` and `EXPO_PUBLIC_E2E` unset, driven by the capture runners.
 *
 * Deliberately independent of the E2E flag: `e2eFake` would hide the native replay session the
 * screenshots depend on. Capture mode runs the production path end to end and only suppresses
 * developer-facing chrome.
 */
export const captureMode = process.env.EXPO_PUBLIC_SCREENSHOTS === '1' || previewMode

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
 * The harnesses share fixture restoration and start native replay at bootstrap.
 */
export const fixtureSession = captureMode || smokeMode

/**
 * Whether capture builds show diagnostic badges: REPLAY, development build and GPS receiver
 * status. Rider controls, including connection actions and ride recording, always remain visible.
 * Smoke keeps replay diagnostics so its flows can assert which session is running.
 */
export const showDevControls = !captureMode

// Anything a capture run alone changes — the silenced render-rate canary — reads `captureMode`
// directly. Those are not questions about rider-facing tooling, and aliasing the flag under a
// second name would just be the same boolean wearing a hat.
