package expo.modules.vescapecore.config

import expo.modules.vescapecore.protocol.lightsCommandChangesBoardConfig
import expo.modules.vescapecore.runtime.Cancellable
import expo.modules.vescapecore.runtime.Scheduler

internal const val LIGHTS_CONFIG_ECHO_TIMEOUT_MS = 2_000L

// @parity /modules/vescape-core/ios/config/LegacyLightsConfigGate.swift
internal class LegacyLightsConfigGate(
    private val scheduler: Scheduler,
    private val onEchoTimeout: () -> Unit,
    private val timeoutMs: Long = LIGHTS_CONFIG_ECHO_TIMEOUT_MS,
) {
    private var timeoutHandle: Cancellable? = null

    var isEchoPending: Boolean = false
        private set

    fun canSendLights(refloatBaseVersion: String?, configWriteInFlight: Boolean): Boolean =
        !(lightsCommandChangesBoardConfig(refloatBaseVersion) && configWriteInFlight)

    fun onLightsCommandSent(refloatBaseVersion: String?) {
        if (!lightsCommandChangesBoardConfig(refloatBaseVersion)) return
        timeoutHandle?.cancel()
        isEchoPending = true
        timeoutHandle = scheduler.postDelayed(timeoutMs) {
            timeoutHandle = null
            isEchoPending = false
            onEchoTimeout()
        }
    }

    fun onLightsEchoReceived() {
        timeoutHandle?.cancel()
        timeoutHandle = null
        isEchoPending = false
    }

    fun reset() {
        timeoutHandle?.cancel()
        timeoutHandle = null
        isEchoPending = false
    }
}
