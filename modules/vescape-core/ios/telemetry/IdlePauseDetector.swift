import Foundation

/// Keepalive poll spacing while in an Idle Pause: ~1 Hz keeps the resume signal alive.
internal let IDLE_PAUSE_POLL_INTERVAL_MS = 1_000

internal enum IdlePauseTransition {
  case paused
  case resumed
}

/// Whether the Board is carrying a rider, from one Refloat state word.
///
/// RUNNING, TILTBACK and WHEELSLIP are all engaged — a board balancing at a standstill is being
/// ridden, and one in tiltback is being ridden badly. Everything else, including the ready state a
/// board sits in on the ground, is not.
///
/// The one place this is decided. Idle Pause and Accessory measurement demand both ask it, and a
/// second copy of the nibble arithmetic would be a second definition of "riding" that could drift.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/IdlePauseDetector.kt `isRefloatEngaged`
// GET_ALLDATA packs state_compat in the lower nibble and saturation in the upper nibble.
internal func isRefloatEngaged(state: Int) -> Bool { (1...3).contains(state & 0x0f) }

/// Pauses recording on the first disengaged Refloat sample and resumes on the first engaged sample.
/// RUNNING, TILTBACK, and WHEELSLIP remain engaged, including while balancing at zero speed.
/// Paused polling stays at ~1 Hz, so detecting engagement can take about a second (ADR-0021).
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/IdlePauseDetector.kt
internal final class IdlePauseDetector {
  private var paused = false

  var isPaused: Bool { paused }

  func onSample(state: Int) -> IdlePauseTransition? {
    let nextPaused = !isRefloatEngaged(state: state)
    guard nextPaused != paused else { return nil }
    paused = nextPaused
    return paused ? .paused : .resumed
  }

  func reset() {
    paused = false
  }
}
