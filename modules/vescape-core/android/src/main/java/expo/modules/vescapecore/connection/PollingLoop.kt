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

    private var smoothedPeriodMs = 0.0

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
        const val RATE_SMOOTHING = 0.2
    }
}

internal fun pollIntervalMsForHz(hz: Int): Long = if (hz <= 0) 0L else 1_000L / hz
