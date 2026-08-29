package expo.modules.vescapecore.faults

/**
 * Decides *when* it is safe and useful to ask the controller for its fault register.
 *
 * Terminal reads compete with the response-paced telemetry loop, so they are deliberately rare:
 * an audit runs at a Board Session's start, immediately after a live fault trigger, once per stop
 * while the Board is standing still, and otherwise only on a slow idle fallback. Everything else
 * would spend BLE bandwidth to re-read bytes Vescape already has.
 *
 * Pure and clock-driven: no scheduling, no BLE, no persistence. The Board Session feeds it observed
 * speed and asks what to do.
 *
 * @parity /modules/vescape-core/ios/faults/VescFaultAuditPolicy.swift
 */
class VescFaultAuditPolicy(
  private val minSpacingMs: Long = MIN_SPACING_MS,
  private val idleFallbackMs: Long = IDLE_FALLBACK_MS,
  private val stationarySettleMs: Long = STATIONARY_SETTLE_MS,
  private val movingSpeedKmh: Double = MOVING_SPEED_KMH,
) {
  private var lastAuditAtMs: Long? = null
  private var stationarySinceMs: Long? = null
  private var stationaryAudited = false

  /** A read was just started for any reason: everything spaces itself off this moment. */
  fun onAuditStarted(nowMs: Long) {
    lastAuditAtMs = nowMs
  }

  /** A new Board Session began. Nothing carries over; the connect audit is the session's first. */
  fun onSessionStarted() {
    lastAuditAtMs = null
    stationarySinceMs = null
    stationaryAudited = false
  }

  /**
   * One decoded telemetry sample was observed.
   *
   * @return the reason to audit now, or null. Never returns a reason inside [minSpacingMs] of the
   *   previous audit, so a stationary Board is not re-read every frame.
   */
  fun observe(nowMs: Long, speedKmh: Double): VescFaultRegisterReason? {
    if (speedKmh > movingSpeedKmh) {
      // Moving again: the next stop earns its own audit.
      stationarySinceMs = null
      stationaryAudited = false
      return null
    }
    val since = stationarySinceMs ?: nowMs.also { stationarySinceMs = it }
    if (!spacingElapsed(nowMs)) return null
    if (!stationaryAudited && nowMs - since >= stationarySettleMs) {
      stationaryAudited = true
      return VescFaultRegisterReason.STATIONARY
    }
    val last = lastAuditAtMs ?: return null
    if (nowMs - last >= idleFallbackMs) return VescFaultRegisterReason.IDLE
    return null
  }

  private fun spacingElapsed(nowMs: Long): Boolean {
    val last = lastAuditAtMs ?: return true
    return nowMs - last >= minSpacingMs
  }

  companion object {
    /** Floor between any two reads within one session. */
    internal const val MIN_SPACING_MS = 60_000L

    /** A session that never stops still audits this often. */
    internal const val IDLE_FALLBACK_MS = 15 * 60_000L

    /** How long the Board must stand still before a stop counts as a safe audit opportunity. */
    internal const val STATIONARY_SETTLE_MS = 5_000L

    /** Above this speed the Board is moving, so a terminal read is not a safe opportunity. */
    internal const val MOVING_SPEED_KMH = 1.0
  }
}
