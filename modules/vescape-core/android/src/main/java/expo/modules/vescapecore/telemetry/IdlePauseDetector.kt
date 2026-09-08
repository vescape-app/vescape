package expo.modules.vescapecore.telemetry

import kotlin.math.abs

/** Keepalive poll spacing while in an Idle Pause: ~1 Hz keeps the resume signal alive. */
internal const val IDLE_PAUSE_POLL_INTERVAL_MS = 1_000L

/**
 * Continuous non-moving time before a Ride Recording enters an Idle Pause.
 * @parity /modules/vescape-core/ios/telemetry/IdlePauseDetector.swift `DEFAULT_IDLE_PAUSE_AFTER_MS`
 */
internal const val DEFAULT_IDLE_PAUSE_AFTER_MS = 30_000L

internal enum class IdlePauseTransition { Paused, Resumed }

/**
 * Decides when a Ride Recording enters or leaves an Idle Pause (CONTEXT.md, ADR-0021).
 *
 * Pure state machine fed each sample's speed; it returns a transition only when the pause state
 * flips. "Moving" reuses the low-speed metric sanitizer's rule (`abs(speed) >= threshold`) so there
 * is one definition of moving shared with the Moving Window. Asymmetric on purpose: pauses only
 * after [pauseAfterMs] of continuous non-moving samples, resumes on the first moving sample —
 * slow-to-pause / instant-to-resume prevents flapping at traffic lights.
 *
 * @parity /modules/vescape-core/ios/telemetry/IdlePauseDetector.swift
 */
internal class IdlePauseDetector(
  private val pauseAfterMs: Long = DEFAULT_IDLE_PAUSE_AFTER_MS,
) {
  private var paused = false
  private var nonMovingSinceMs: Long? = null

  val isPaused: Boolean get() = paused

  fun onSample(speedCentiKmh: Int, movingThresholdCentiKmh: Int, atMs: Long): IdlePauseTransition? {
    // Mirror LowSpeedAverageSpeedSanitizer exactly: moving when abs(speed) >= threshold (>= 0).
    // A threshold of 0 means every sample is moving, so a stopped board never idle-pauses.
    val moving = abs(speedCentiKmh) >= movingThresholdCentiKmh.coerceAtLeast(0)
    if (moving) {
      nonMovingSinceMs = null
      if (!paused) return null
      paused = false
      return IdlePauseTransition.Resumed
    }
    if (paused) return null
    val since = nonMovingSinceMs ?: atMs.also { nonMovingSinceMs = it }
    if (atMs - since < pauseAfterMs) return null
    paused = true
    return IdlePauseTransition.Paused
  }

  fun reset() {
    paused = false
    nonMovingSinceMs = null
  }
}
