import Foundation

/// Keepalive poll spacing while in an Idle Pause: ~1 Hz keeps the resume signal alive.
internal let IDLE_PAUSE_POLL_INTERVAL_MS = 1_000

/// Continuous non-moving time before a Ride Recording enters an Idle Pause.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/IdlePauseDetector.kt `DEFAULT_IDLE_PAUSE_AFTER_MS`
internal let DEFAULT_IDLE_PAUSE_AFTER_MS: Int64 = 30_000

internal enum IdlePauseTransition {
  case paused
  case resumed
}

/// Decides when a Ride Recording enters or leaves an Idle Pause (CONTEXT.md, ADR-0021).
///
/// Pure state machine fed each sample's speed; it returns a transition only when the pause state
/// flips. "Moving" reuses the low-speed metric sanitizer's rule (`abs(speed) >= threshold`) so there
/// is one definition of moving shared with the Moving Window. Asymmetric on purpose: pauses only
/// after `pauseAfterMs` of continuous non-moving samples, resumes on the first moving sample —
/// slow-to-pause / instant-to-resume prevents flapping at traffic lights.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/IdlePauseDetector.kt
internal final class IdlePauseDetector {
  private let pauseAfterMs: Int64
  private var paused = false
  private var nonMovingSinceMs: Int64?

  init(pauseAfterMs: Int64 = DEFAULT_IDLE_PAUSE_AFTER_MS) {
    self.pauseAfterMs = pauseAfterMs
  }

  var isPaused: Bool { paused }

  func onSample(speedCentiKmh: Int, movingThresholdCentiKmh: Int, atMs: Int64) -> IdlePauseTransition? {
    // Mirror MetricSanitizer exactly: moving when abs(speed) >= threshold (>= 0).
    // A threshold of 0 means every sample is moving, so a stopped board never idle-pauses.
    let moving = abs(speedCentiKmh) >= max(0, movingThresholdCentiKmh)
    if moving {
      nonMovingSinceMs = nil
      if !paused { return nil }
      paused = false
      return .resumed
    }
    if paused { return nil }
    let since: Int64
    if let existing = nonMovingSinceMs {
      since = existing
    } else {
      since = atMs
      nonMovingSinceMs = atMs
    }
    if atMs - since < pauseAfterMs { return nil }
    paused = true
    return .paused
  }

  func reset() {
    paused = false
    nonMovingSinceMs = nil
  }
}
