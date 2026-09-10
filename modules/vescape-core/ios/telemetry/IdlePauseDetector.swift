import Foundation

/// Keepalive poll spacing while in an Idle Pause: ~1 Hz keeps the resume signal alive.
internal let IDLE_PAUSE_POLL_INTERVAL_MS = 1_000

internal enum IdlePauseTransition {
  case paused
  case resumed
}

/// Pauses recording on the first disengaged Refloat sample and resumes on the first engaged sample.
/// RUNNING, TILTBACK, and WHEELSLIP remain engaged, including while balancing at zero speed.
/// Paused polling stays at ~1 Hz, so detecting engagement can take about a second (ADR-0021).
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/IdlePauseDetector.kt
internal final class IdlePauseDetector {
  private var paused = false

  var isPaused: Bool { paused }

  func onSample(state: Int) -> IdlePauseTransition? {
    // GET_ALLDATA packs state_compat in the lower nibble and saturation in the upper nibble.
    let nextPaused = !(1...3).contains(state & 0x0f)
    guard nextPaused != paused else { return nil }
    paused = nextPaused
    return paused ? .paused : .resumed
  }

  func reset() {
    paused = false
  }
}
