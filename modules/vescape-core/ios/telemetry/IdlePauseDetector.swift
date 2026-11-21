import Foundation

internal let IDLE_PAUSE_POLL_INTERVAL_MS = 1_000

internal enum IdlePauseTransition {
  case paused
  case resumed
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/IdlePauseDetector.kt `isRefloatEngaged`
internal func isRefloatEngaged(state: Int) -> Bool { (1...3).contains(state & 0x0f) }

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
