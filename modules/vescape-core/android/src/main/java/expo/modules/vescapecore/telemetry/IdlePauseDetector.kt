package expo.modules.vescapecore.telemetry

/** Keepalive poll spacing while in an Idle Pause: ~1 Hz keeps the resume signal alive. */
internal const val IDLE_PAUSE_POLL_INTERVAL_MS = 1_000L

internal enum class IdlePauseTransition { Paused, Resumed }

/**
 * Pauses recording on the first disengaged Refloat sample and resumes on the first engaged sample.
 * RUNNING, TILTBACK, and WHEELSLIP remain engaged, including while balancing at zero speed.
 * Paused polling stays at ~1 Hz, so detecting engagement can take about a second (ADR-0021).
 *
 * @parity /modules/vescape-core/ios/telemetry/IdlePauseDetector.swift
 */
internal class IdlePauseDetector {
  private var paused = false

  val isPaused: Boolean get() = paused

  fun onSample(state: Int): IdlePauseTransition? {
    // GET_ALLDATA packs state_compat in the lower nibble and saturation in the upper nibble.
    val nextPaused = (state and 0x0f) !in 1..3
    if (nextPaused == paused) return null
    paused = nextPaused
    return if (paused) IdlePauseTransition.Paused else IdlePauseTransition.Resumed
  }

  fun reset() {
    paused = false
  }
}
