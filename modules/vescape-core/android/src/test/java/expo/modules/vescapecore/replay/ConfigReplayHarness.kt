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
 * Config-scoped Board Warning replay harness (ADR 0024): reconstructs the Refloat config read from a
 * `.jsonl` Debug Recording by driving the **real** [ConfigRWFsm] with the recorded `rx` packets, then
 * returns the decoded [BoardConfigValues] the config-safety detector evaluates. Nothing is
 * re-implemented — the same reassembler, protocol parser, schema parser, and config decoder the live
 * session uses run here; only the transport (request sending) and side effects are stubbed, exactly
 * as the transport-seam replay does for the telemetry-scoped detectors.
 *
 * @parity /modules/vescape-core/ios/replay/ConfigReplayHarness.swift
 */
internal object ConfigReplayHarness {
  /**
   * Board Config Values decoded from the recording's config read, or null when the recording holds
   * no completable config exchange (the config-scoped detector then evaluates nothing).
   */
  fun decodeBoardConfigValues(jsonl: String): BoardConfigValues? {
    val reassembler = VescPacketReassembler()
    var state: ConfigRWState = ConfigRWState.Idle
    var captured: BoardConfigValues? = null

    fun dispatch(event: ConfigRWEvent) {
      val (next, effects) = ConfigRWFsm.apply(state, event)
      state = next
      for (effect in effects) {
        // The FSM's SendFrame/ScheduleTimeout effects drive a live request/response loop; replay
        // supplies the responses from the recording, so those effects are swallowed. Only the decode
        // result matters here.
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

  /** Classify a reassembled packet exactly as the live session controller routes config responses. */
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
