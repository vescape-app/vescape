package expo.modules.vescapecore.connection

import expo.modules.vescapecore.protocol.COMM_FORWARD_CAN

/**
 * @parity /modules/vescape-core/ios/protocol/VescProtocol.swift
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

    fun decode(stored: String?): BoardTransport? = when {
      stored == null -> null
      stored == DIRECT -> Direct
      else -> stored.toIntOrNull()?.let(::canIdOrNull)
    }

    fun encode(transport: BoardTransport?): String? = when (transport) {
      null -> null
      Direct -> DIRECT
      is Can -> transport.canId.toString()
    }

    fun fromBridge(value: Any?): BoardTransport? = when (value) {
      null -> null
      DIRECT -> Direct
      is Number -> canIdOrNull(value.toInt())
      else -> null
    }

    fun toBridge(transport: BoardTransport?): Any? = when (transport) {
      null -> null
      Direct -> DIRECT
      is Can -> transport.canId
    }

    private fun canIdOrNull(canId: Int): BoardTransport? =
      if (canId in 0..255) Can(canId) else null
  }
}
