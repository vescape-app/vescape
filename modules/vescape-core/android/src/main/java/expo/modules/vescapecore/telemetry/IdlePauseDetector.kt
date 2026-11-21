package expo.modules.vescapecore.telemetry

internal const val IDLE_PAUSE_POLL_INTERVAL_MS = 1_000L

internal enum class IdlePauseTransition { Paused, Resumed }

/**
 * @parity /modules/vescape-core/ios/telemetry/IdlePauseDetector.swift `isRefloatEngaged`
 */
internal fun isRefloatEngaged(state: Int): Boolean = (state and 0x0f) in 1..3

/**
 * @parity /modules/vescape-core/ios/telemetry/IdlePauseDetector.swift
 */
internal class IdlePauseDetector {
  private var paused = false

  val isPaused: Boolean get() = paused

  fun onSample(state: Int): IdlePauseTransition? {
    val nextPaused = !isRefloatEngaged(state)
    if (nextPaused == paused) return null
    paused = nextPaused
    return if (paused) IdlePauseTransition.Paused else IdlePauseTransition.Resumed
  }

  fun reset() {
    paused = false
  }
}
