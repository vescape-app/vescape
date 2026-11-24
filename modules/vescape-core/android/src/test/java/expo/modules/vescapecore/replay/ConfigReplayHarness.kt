package expo.modules.vescapecore.replay

import expo.modules.vescapecore.config.BoardConfigOperationOrigin
import expo.modules.vescapecore.config.BoardConfigValues
import expo.modules.vescapecore.config.BoardRideState
import expo.modules.vescapecore.config.ConfigConnectionSnapshot
import expo.modules.vescapecore.config.ConfigRWController
import expo.modules.vescapecore.config.ConfigRWControllerPort
import expo.modules.vescapecore.config.PendingConfigRead
import expo.modules.vescapecore.connection.BoardPhase
import expo.modules.vescapecore.connection.BoardTransport
import expo.modules.vescapecore.protocol.BoardLightsState
import expo.modules.vescapecore.protocol.VescPacketReassembler
import expo.modules.vescapecore.protocol.parseLightsControlResponse
import expo.modules.vescapecore.protocol.parseRefloatGetAllData
import expo.modules.vescapecore.runtime.LinkIntegrity
import expo.modules.vescapecore.runtime.TestScheduler
import expo.modules.vescapecore.service.SessionConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers

internal data class ConfigReplayRoutingResult(
  val values: BoardConfigValues?,
  val telemetryCountDuringInFlight: Int,
  val lightsDuringInFlight: List<BoardLightsState>,
)

/**
 * @parity /modules/vescape-core/ios/replay/ConfigReplayHarness.swift
 */
internal object ConfigReplayHarness {
  fun decodeBoardConfigValues(jsonl: String): BoardConfigValues? =
    replayRouting(jsonl).values

  fun replayRouting(
    jsonl: String,
    injectedDuringInFlight: List<ByteArray> = emptyList(),
  ): ConfigReplayRoutingResult {
    var captured: BoardConfigValues? = null
    val config = SessionConfig(
      appBoardId = "replay",
      deviceId = "replay",
      deviceName = "Replay",
      transport = BoardTransport.Direct,
      pollIntervalMs = 1000,
      recordingEnabled = false,
      telemetryRecordingEnabled = false,
      refloatVersion = "Refloat 3.0.7",
    )
    val controller = ConfigRWController(
      scheduler = TestScheduler(),
      appDataScope = CoroutineScope(Dispatchers.Unconfined),
      loadProfile = { null },
      port = object : ConfigRWControllerPort {
        override fun connection() = ConfigConnectionSnapshot(
          config = config,
          phase = BoardPhase.Connected,
          transport = BoardTransport.Direct,
          fwVersion = null,
          linkIntegrity = LinkIntegrity.Trusted,
          rideState = BoardRideState(state = 0, switchState = 0, receivedAtMs = System.currentTimeMillis()),
        )

        override fun isPollingActive() = false
        override fun stopPolling() = Unit
        override fun startPolling() = Unit
        override fun sendPayload(payload: ByteArray) = true
        override fun captureDiagnostic(name: String, properties: Map<String, Any?>) = Unit
        override fun diagnosticProperties(config: SessionConfig?, category: String) = emptyMap<String, Any?>()
        override fun dumpDebugBytes(xmlBytes: ByteArray, configBytes: ByteArray) = Unit
        override fun onBoardConfigValues(values: BoardConfigValues, origin: BoardConfigOperationOrigin) {
          captured = values
        }
        override fun demoteWriteBase() = Unit
      },
    )
    controller.consumeRead(PendingConfigRead(onSuccess = {}, onError = { _, _ -> }))

    var telemetryCount = 0
    val lights = mutableListOf<BoardLightsState>()

    fun route(packet: ByteArray, atMs: Long) {
      val wasInFlight = controller.isInFlight
      if (controller.onPayload(packet, atMs)) return
      if (!wasInFlight) return
      parseLightsControlResponse(packet)?.let {
        lights.add(it)
        return
      }
      if (parseRefloatGetAllData(packet, null, atMs, null) != null) {
        telemetryCount += 1
      }
    }

    var injected = false
    val reassembler = VescPacketReassembler()
    for (chunk in ReplayChunkDecoder.rxChunks(jsonl)) {
      for (packet in reassembler.feed(chunk.bytes)) {
        if (captured != null) break
        route(packet, chunk.t)
        if (!injected && controller.isInFlight) {
          injected = true
          for (extra in injectedDuringInFlight) route(extra, chunk.t)
        }
      }
      if (captured != null) break
    }

    return ConfigReplayRoutingResult(captured, telemetryCount, lights)
  }
}
