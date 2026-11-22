package expo.modules.vescapecore.replay

import expo.modules.vescapecore.config.ConfigRWEffect
import expo.modules.vescapecore.config.ConfigRWEvent
import expo.modules.vescapecore.config.ConfigRWFsm
import expo.modules.vescapecore.config.ConfigRWState
import expo.modules.vescapecore.connection.BoardTransport
import expo.modules.vescapecore.protocol.COMM_CUSTOM_APP_DATA
import expo.modules.vescapecore.protocol.COMM_FORWARD_CAN
import expo.modules.vescapecore.protocol.COMM_GET_CUSTOM_CONFIG
import expo.modules.vescapecore.protocol.COMM_GET_CUSTOM_CONFIG_XML
import expo.modules.vescapecore.protocol.VescPacketReassembler
import expo.modules.vescapecore.config.BoardConfigValues

/**
 * @parity /modules/vescape-core/ios/replay/ConfigReplayHarness.swift
 */
internal object ConfigReplayHarness {
  fun decodeBoardConfigValues(jsonl: String): BoardConfigValues? {
    val reassembler = VescPacketReassembler()
    var state: ConfigRWState = ConfigRWState.Idle
    var captured: BoardConfigValues? = null

    fun dispatch(event: ConfigRWEvent) {
      val (next, effects) = ConfigRWFsm.apply(state, event)
      state = next
      for (effect in effects) {
        if (effect is ConfigRWEffect.EmitReadComplete) effect.boardConfigValues?.let { captured = it }
      }
    }

    dispatch(
      ConfigRWEvent.StartRead(
        opId = "replay",
        canId = null,
        transport = BoardTransport.Direct,
        wasPolling = false,
        appBoardId = null,
        fwVersion = null,
        refloatBaseVersion = null,
      ),
    )

    for (chunk in ReplayChunkDecoder.rxChunks(jsonl)) {
      for (packet in reassembler.feed(chunk.bytes)) {
        if (captured != null) break
        eventFor(packet, chunk.t)?.let(::dispatch)
      }
      if (captured != null) break
    }

    return captured
  }

  private fun eventFor(packet: ByteArray, capturedAtMs: Long): ConfigRWEvent? {
    if (packet.isEmpty()) return null
    val cmd = packet[0].toInt() and 0xff
    val appCmd = if (cmd == COMM_FORWARD_CAN && packet.size >= 3) packet[2].toInt() and 0xff else cmd
    return when (appCmd) {
      COMM_GET_CUSTOM_CONFIG_XML -> ConfigRWEvent.XmlPayloadReceived(packet)
      COMM_GET_CUSTOM_CONFIG -> ConfigRWEvent.ConfigBytesPayloadReceived(packet, capturedAtMs)
      COMM_CUSTOM_APP_DATA -> ConfigRWEvent.InfoPayloadReceived(packet)
      else -> null
    }
  }
}
