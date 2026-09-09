package expo.modules.vescapecore.connection

import expo.modules.vescapecore.protocol.COMM_BMS_GET_VALUES
import expo.modules.vescapecore.protocol.COMM_CUSTOM_APP_DATA
import expo.modules.vescapecore.protocol.REFLOAT_GET_ALLDATA
import expo.modules.vescapecore.protocol.REFLOAT_MAGIC
import expo.modules.vescapecore.service.SessionConfig

import expo.modules.vescapecore.runtime.BoardSession
import expo.modules.vescapecore.runtime.Cancellable
import expo.modules.vescapecore.runtime.Scheduler
import expo.modules.vescapecore.runtime.postDelayedForSession
import kotlin.math.max

/** @parity /modules/vescape-core/ios/connection/PollingLoop.swift */
internal class PollingLoop(
    private val scheduler: Scheduler,
    private val isCurrentSession: (BoardSession) -> Boolean,
    private val sendPayloadWithRetry: (ByteArray, BoardSession) -> Boolean,
    private val nowMs: () -> Long = { System.currentTimeMillis() },
) {
    private var pollHandle: Cancellable? = null
    private var safetyHandle: Cancellable? = null
    private var lastPollAt = 0L
    private var tick = 0L
    private var active = false
    private var current: Active? = null

    /**
     * EWMA of the interval between successive polls, in ms. The loop is response-paced, so the send
     * cadence equals the achieved telemetry rate. 0 = not yet measured. Exposed as [measuredRateHz]
     * so the UI can show the real pull rate the link is sustaining, distinct from the requested cap.
     */
    private var smoothedPeriodMs = 0.0

    /**
     * Minimum spacing between requests, in ms. 0 = unlimited (pure response-paced). Held as a
     * standalone field rather than inside [Active] so the rate cap can be changed live mid-session
     * (see [setPollIntervalMs]). Volatile because live updates arrive off the loop's thread.
     */
    @Volatile
    private var floorMs = 0L

    private data class Active(
        val session: BoardSession,
        val payload: ByteArray,
        val bmsPayload: ByteArray?,
    )

    val isActive: Boolean
        get() = active

    fun start(
        sessionConfig: SessionConfig,
        session: BoardSession,
        transport: BoardTransport,
    ) {
        val pollPayload = pollPayload(transport)
        // BMS is polled only when the probe proved one present (`hasBms == true`). The probe
        // is authoritative: unknown (legacy `null`) or proven-absent (`false`) → never poll.
        val bmsPayload = if (sessionConfig.hasBms == true) bmsPayload(transport) else null
        stop()
        tick = 0L
        lastPollAt = 0L
        smoothedPeriodMs = 0.0
        floorMs = max(0L, sessionConfig.pollIntervalMs)
        current = Active(session, pollPayload, bmsPayload)
        active = true
        sendNow()
    }

    /**
     * Live-update the rate cap for the active session, e.g. when the rider changes the telemetry
     * rate limit mid-ride. The new floor lands on the next scheduled poll; pacing stays
     * response-paced, so this never outruns the controller.
     */
    fun setPollIntervalMs(intervalMs: Long) {
        floorMs = max(0L, intervalMs)
    }

    fun stop() {
        active = false
        pollHandle?.cancel()
        pollHandle = null
        cancelSafety()
        current = null
    }

    /**
     * Called when a telemetry response for the active session arrives. Schedules the next poll
     * response-paced: as soon as the previous response lands, respecting [SessionConfig.pollIntervalMs]
     * as a minimum spacing floor. This self-clocks to the real link rate instead of firing on a fixed
     * timer that can outrun the board and pile up requests.
     */
    fun onResponse() {
        val ctx = current ?: return
        if (!active) return
        cancelSafety()
        val elapsed = nowMs() - lastPollAt
        val delay = max(0L, floorMs - elapsed)
        pollHandle?.cancel()
        pollHandle = scheduler.postDelayedForSession(ctx.session, delay, isCurrentSession) { sendNow() }
    }

    fun updateLatency(now: Long): Int? {
        if (lastPollAt <= 0) return null
        return max(0, now - lastPollAt).toInt()
    }

    /** Achieved telemetry rate in Hz (smoothed), or null before the second poll lands. */
    fun measuredRateHz(): Double? {
        if (smoothedPeriodMs <= 0.0) return null
        return 1_000.0 / smoothedPeriodMs
    }

    private fun sendNow() {
        val ctx = current ?: return
        val now = nowMs()
        if (lastPollAt > 0L) {
            val delta = (now - lastPollAt).toDouble()
            smoothedPeriodMs =
                if (smoothedPeriodMs <= 0.0) delta
                else smoothedPeriodMs + RATE_SMOOTHING * (delta - smoothedPeriodMs)
        }
        lastPollAt = now
        sendPayloadWithRetry(ctx.payload, ctx.session)
        // BMS values change slowly; poll them at 1/BMS_POLL_STRIDE of the telemetry rate
        // to avoid crowding the BLE link with large cell-voltage replies.
        // @parity /modules/vescape-core/ios/connection/BoardSessionController.swift (sendPoll BMS interleave)
        if (ctx.bmsPayload != null && tick % BMS_POLL_STRIDE == 0L) {
            sendPayloadWithRetry(ctx.bmsPayload, ctx.session)
        }
        tick++
        armSafety(ctx)
    }

    private fun armSafety(ctx: Active) {
        cancelSafety()
        val timeout = max(floorMs * 4, SAFETY_MIN_MS)
        safetyHandle = scheduler.postDelayedForSession(ctx.session, timeout, isCurrentSession) {
            safetyHandle = null
            // No response within the safety window: assume the request or reply was dropped and re-poll
            // so the loop recovers instead of stalling until the stale watchdog tears the session down.
            sendNow()
        }
    }

    private fun cancelSafety() {
        safetyHandle?.cancel()
        safetyHandle = null
    }

    private fun pollPayload(transport: BoardTransport): ByteArray =
        transport.frame(
            byteArrayOf(
                COMM_CUSTOM_APP_DATA.toByte(),
                REFLOAT_MAGIC.toByte(),
                REFLOAT_GET_ALLDATA.toByte(),
                2,
            ),
        )

    private fun bmsPayload(transport: BoardTransport): ByteArray =
        transport.frame(byteArrayOf(COMM_BMS_GET_VALUES.toByte()))

    private companion object {
        const val SAFETY_MIN_MS = 1_000L
        const val BMS_POLL_STRIDE = 8L
        // EWMA weight for the newest poll interval. Low enough to ride out jitter, high enough to
        // track a real rate change (e.g. rider drops the rate cap mid-ride) within a second or two.
        const val RATE_SMOOTHING = 0.2
    }
}

/** Max poll rate in Hz → minimum request-spacing floor in ms. 0 (or less) = unlimited. */
internal fun pollIntervalMsForHz(hz: Int): Long = if (hz <= 0) 0L else 1_000L / hz
