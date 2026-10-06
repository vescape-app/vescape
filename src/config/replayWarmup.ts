/**
 * Replay warmup for a fixture session: how much recorded ride the session opens with already on the
 * charts, and how much faster than real time native delivers it. 6 minutes at 30× costs about
 * twelve seconds of real waiting.
 *
 * The window is deliberately wider than `AppSettings.liveHistoryLimit` (5 minutes), so the detail
 * charts open full and a smoke run reaches asserted telemetry — speed, temps, duty cycle — without
 * spending minutes earning it.
 *
 * Its own file, not part of `@/config/fixtureSession`, because both the app and the Node runners
 * (`scripts/screenshots.ts`, `scripts/smoke.ts`) read it — and a runner cannot import anything that
 * reaches `react-native`. Keeping it RN-free is what makes it one definition instead of a parity
 * pair.
 */

export const REPLAY_WARMUP_MS = 6 * 60_000
export const REPLAY_WARMUP_SPEED = 30
