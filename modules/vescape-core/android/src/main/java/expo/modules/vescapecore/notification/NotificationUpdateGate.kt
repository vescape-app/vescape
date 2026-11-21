package expo.modules.vescapecore.notification

import expo.modules.vescapecore.connection.BoardPhase

// @platform-diff No iOS peer: iOS ConnectionCoordinator calls RideLiveActivityController.update
// directly on every snapshot (ActivityKit coalesces) instead of throttling by phase/interval.
internal class NotificationUpdateGate(
    private val minIntervalMs: Long,
) {
    private var lastPostAtMs: Long = Long.MIN_VALUE
    private var lastPhase: BoardPhase? = null

    fun shouldPost(phase: BoardPhase, nowMs: Long, force: Boolean = false): Boolean {
        if (force || phase != lastPhase || nowMs - lastPostAtMs >= minIntervalMs) {
            lastPhase = phase
            lastPostAtMs = nowMs
            return true
        }
        return false
    }
}
