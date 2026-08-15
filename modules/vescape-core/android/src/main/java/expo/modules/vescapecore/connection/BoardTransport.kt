package expo.modules.vescapecore.connection

import expo.modules.vescapecore.protocol.COMM_FORWARD_CAN

/**
 * @parity /modules/vescape-core/ios/protocol/VescProtocol.swift
 *
 * How a Board is reached. Resolved once by detection and stored on the Board.
 * A `null` transport means undetected — there is no persisted "unknown" state.
 *
 * Persisted form (board_settings transport JSON scalar): null | "direct" | "<canId>".
 * Bridge form (JS): null | "direct" | Int.
 */
sealed interface BoardTransport {
  fun frame(cmd: ByteArray): ByteArray

  object Direct : BoardTransport {
    override fun frame(cmd: ByteArray): ByteArray = cmd
  }

  data class Can(val canId: Int) : BoardTransport {
    init {
      require(canId in 0..255) { "canId must fit uint8" }
    }

    override fun frame(cmd: ByteArray): ByteArray =
      byteArrayOf(COMM_FORWARD_CAN.toByte(), canId.toByte()) + cmd
  }

  companion object {
    const val DIRECT = "direct"

    /** Decode the persisted TEXT column. Junk decodes to `null` (undetected). */
    fun decode(stored: String?): BoardTransport? = when {
      stored == null -> null
      stored == DIRECT -> Direct
      else -> stored.toIntOrNull()?.let(::canIdOrNull)
    }

    /** Encode to the persisted TEXT column. */
    fun encode(transport: BoardTransport?): String? = when (transport) {
      null -> null
      Direct -> DIRECT
      is Can -> transport.canId.toString()
    }

    /** Coerce a bridge value coming from JS (null | "direct" | Number). */
    fun fromBridge(value: Any?): BoardTransport? = when (value) {
      null -> null
      DIRECT -> Direct
      is Number -> canIdOrNull(value.toInt())
      else -> null
    }

    /** Project to a bridge value for JS (null | "direct" | Int). */
    fun toBridge(transport: BoardTransport?): Any? = when (transport) {
      null -> null
      Direct -> DIRECT
      is Can -> transport.canId
    }

    private fun canIdOrNull(canId: Int): BoardTransport? =
      if (canId in 0..255) Can(canId) else null
  }
}
