package expo.modules.vescapecore.config

import expo.modules.vescapecore.connection.BoardTransport
import expo.modules.vescapecore.protocol.COMM_CUSTOM_APP_DATA
import expo.modules.vescapecore.protocol.COMM_FORWARD_CAN
import expo.modules.vescapecore.protocol.COMM_GET_CUSTOM_CONFIG
import expo.modules.vescapecore.protocol.COMM_GET_CUSTOM_CONFIG_XML
import expo.modules.vescapecore.protocol.COMM_SET_CUSTOM_CONFIG
import expo.modules.vescapecore.protocol.REFLOAT_GET_INFO
import expo.modules.vescapecore.protocol.REFLOAT_MAGIC

import java.nio.ByteBuffer
import java.nio.ByteOrder

// @parity /modules/vescape-core/ios/config/RefloatConfigProtocol.swift
internal data class RefloatConfigXmlChunk(
  val confInd: Int,
  val totalLength: Int,
  val offset: Int,
  val chunk: ByteArray,
)

internal data class RefloatConfigBytes(
  val confInd: Int,
  val packageSignature: Long,
  val config: ByteArray,
)

internal data class RefloatPackageInfo(
  val version: String,
)

internal sealed class RefloatConfigProtocolResult<out T> {
  data class Success<T>(val value: T) : RefloatConfigProtocolResult<T>()
  data class Failure(val message: String) : RefloatConfigProtocolResult<Nothing>()
}

internal object RefloatConfigProtocol {
  private val baseVersionPattern = Regex("""\b(\d+\.\d+(?:\.\d+)?)\b""")

  fun normalizeBaseVersion(version: String?): String? =
    version
      ?.trim()
      ?.takeIf { it.isNotEmpty() }
      ?.let { baseVersionPattern.find(it)?.groupValues?.get(1) }

  private fun commandOffset(payload: ByteArray, expectedCommand: Int): RefloatConfigProtocolResult<Int> {
    if (payload.isEmpty()) {
      return RefloatConfigProtocolResult.Failure("Empty Refloat config response")
    }
    val cmd = payload[0].toInt() and 0xff
    if (cmd == expectedCommand) return RefloatConfigProtocolResult.Success(0)
    if (cmd == COMM_FORWARD_CAN) {
      if (payload.size < 3) {
        return RefloatConfigProtocolResult.Failure("Short forwarded Refloat config response")
      }
      val forwarded = payload[2].toInt() and 0xff
      if (forwarded == expectedCommand) return RefloatConfigProtocolResult.Success(2)
      return RefloatConfigProtocolResult.Failure(
        "Unexpected forwarded Refloat config command $forwarded, expected $expectedCommand",
      )
    }
    return RefloatConfigProtocolResult.Failure(
      "Unexpected Refloat config command $cmd, expected $expectedCommand",
    )
  }

  private fun appCommandOffset(payload: ByteArray, expectedCommand: Int): RefloatConfigProtocolResult<Int> {
    if (payload.size < 3) {
      return RefloatConfigProtocolResult.Failure("Short Refloat app response")
    }
    val cmd = payload[0].toInt() and 0xff
    if (cmd == COMM_CUSTOM_APP_DATA) {
      val magic = payload[1].toInt() and 0xff
      val appCommand = payload[2].toInt() and 0xff
      if (magic != REFLOAT_MAGIC) {
        return RefloatConfigProtocolResult.Failure("Unexpected Refloat magic $magic")
      }
      if (appCommand == expectedCommand) return RefloatConfigProtocolResult.Success(2)
      return RefloatConfigProtocolResult.Failure(
        "Unexpected Refloat app command $appCommand, expected $expectedCommand",
      )
    }
    if (cmd == COMM_FORWARD_CAN) {
      if (payload.size < 5) {
        return RefloatConfigProtocolResult.Failure("Short forwarded Refloat app response")
      }
      val forwarded = payload[2].toInt() and 0xff
      val magic = payload[3].toInt() and 0xff
      val appCommand = payload[4].toInt() and 0xff
      if (forwarded != COMM_CUSTOM_APP_DATA) {
        return RefloatConfigProtocolResult.Failure(
          "Unexpected forwarded Refloat command $forwarded, expected $COMM_CUSTOM_APP_DATA",
        )
      }
      if (magic != REFLOAT_MAGIC) {
        return RefloatConfigProtocolResult.Failure("Unexpected Refloat magic $magic")
      }
      if (appCommand == expectedCommand) return RefloatConfigProtocolResult.Success(4)
      return RefloatConfigProtocolResult.Failure(
        "Unexpected forwarded Refloat app command $appCommand, expected $expectedCommand",
      )
    }
    return RefloatConfigProtocolResult.Failure(
      "Unexpected Refloat app response command $cmd, expected $COMM_CUSTOM_APP_DATA",
    )
  }

  fun buildGetInfo(transport: BoardTransport, version: Int = 1): ByteArray {
    require(version in 0..255) { "version must fit uint8" }
    return transport.frame(
      byteArrayOf(
        COMM_CUSTOM_APP_DATA.toByte(),
        REFLOAT_MAGIC.toByte(),
        REFLOAT_GET_INFO.toByte(),
        version.toByte(),
      ),
    )
  }

  fun buildGetCustomConfigXml(
    transport: BoardTransport,
    confInd: Int,
    length: Int,
    offset: Int,
  ): ByteArray {
    require(confInd in 0..255) { "confInd must fit uint8" }
    require(length >= 0) { "length must be non-negative" }
    require(offset >= 0) { "offset must be non-negative" }
    val cmd = ByteBuffer.allocate(10)
      .order(ByteOrder.BIG_ENDIAN)
      .put(COMM_GET_CUSTOM_CONFIG_XML.toByte())
      .put(confInd.toByte())
      .putInt(length)
      .putInt(offset)
      .array()
    return transport.frame(cmd)
  }

  fun buildGetCustomConfig(transport: BoardTransport, confInd: Int): ByteArray {
    require(confInd in 0..255) { "confInd must fit uint8" }
    return transport.frame(byteArrayOf(COMM_GET_CUSTOM_CONFIG.toByte(), confInd.toByte()))
  }

  fun parseCustomConfigXmlResponse(
    payload: ByteArray,
    expectedConfInd: Int = 0,
  ): RefloatConfigProtocolResult<RefloatConfigXmlChunk> {
    val cmdOffset = when (val result = commandOffset(payload, COMM_GET_CUSTOM_CONFIG_XML)) {
      is RefloatConfigProtocolResult.Success -> result.value
      is RefloatConfigProtocolResult.Failure -> return result
    }
    if (payload.size < cmdOffset + 10) {
      return RefloatConfigProtocolResult.Failure(
        "Short Refloat config XML response: ${payload.size - cmdOffset} bytes",
      )
    }
    val view = ByteBuffer.wrap(payload).order(ByteOrder.BIG_ENDIAN)
    view.position(cmdOffset + 1)
    val confInd = view.get().toInt() and 0xff
    if (confInd != expectedConfInd) {
      return RefloatConfigProtocolResult.Failure("Unexpected Refloat config XML index $confInd")
    }
    val totalLength = view.int
    val dataOffset = view.int
    if (totalLength < 0) {
      return RefloatConfigProtocolResult.Failure("Negative Refloat config XML length $totalLength")
    }
    if (dataOffset < 0 || dataOffset > totalLength) {
      return RefloatConfigProtocolResult.Failure(
        "Invalid Refloat config XML offset $dataOffset for length $totalLength",
      )
    }
    val chunk = payload.copyOfRange(cmdOffset + 10, payload.size)
    if (dataOffset + chunk.size > totalLength) {
      return RefloatConfigProtocolResult.Failure(
        "Refloat config XML chunk exceeds length: offset=$dataOffset chunk=${chunk.size} length=$totalLength",
      )
    }
    return RefloatConfigProtocolResult.Success(RefloatConfigXmlChunk(confInd, totalLength, dataOffset, chunk))
  }

  fun buildSetCustomConfig(
    transport: BoardTransport,
    confInd: Int,
    packageSignature: Long,
    configBytes: ByteArray,
  ): ByteArray {
    require(confInd in 0..255) { "confInd must fit uint8" }
    val buf = ByteBuffer.allocate(6 + configBytes.size).order(ByteOrder.BIG_ENDIAN)
    buf.put(COMM_SET_CUSTOM_CONFIG.toByte())
    buf.put(confInd.toByte())
    buf.putInt(packageSignature.toInt())
    buf.put(configBytes)
    return transport.frame(buf.array())
  }

  fun parseSetCustomConfigResponse(
    payload: ByteArray,
    expectedConfInd: Int = 0,
  ): RefloatConfigProtocolResult<Int> {
    val offset = when (val result = commandOffset(payload, COMM_SET_CUSTOM_CONFIG)) {
      is RefloatConfigProtocolResult.Success -> result.value
      is RefloatConfigProtocolResult.Failure -> return result
    }
    if (payload.size == offset + 1) {
      return RefloatConfigProtocolResult.Success(expectedConfInd)
    }
    val confInd = payload[offset + 1].toInt() and 0xff
    if (confInd != expectedConfInd) {
      return RefloatConfigProtocolResult.Failure("Unexpected Refloat set config index $confInd")
    }
    return RefloatConfigProtocolResult.Success(confInd)
  }

  fun parseCustomConfigResponse(
    payload: ByteArray,
    expectedConfInd: Int = 0,
  ): RefloatConfigProtocolResult<RefloatConfigBytes> {
    val offset = when (val result = commandOffset(payload, COMM_GET_CUSTOM_CONFIG)) {
      is RefloatConfigProtocolResult.Success -> result.value
      is RefloatConfigProtocolResult.Failure -> return result
    }
    if (payload.size < offset + 6) {
      return RefloatConfigProtocolResult.Failure(
        "Short Refloat config response: ${payload.size - offset} bytes",
      )
    }
    val view = ByteBuffer.wrap(payload).order(ByteOrder.BIG_ENDIAN)
    view.position(offset + 2)
    val confInd = payload[offset + 1].toInt() and 0xff
    if (confInd != expectedConfInd) {
      return RefloatConfigProtocolResult.Failure("Unexpected Refloat config index $confInd")
    }
    val packageSignature = view.int.toLong() and 0xffffffffL
    return RefloatConfigProtocolResult.Success(
      RefloatConfigBytes(
        confInd = confInd,
        packageSignature = packageSignature,
        config = payload.copyOfRange(offset + 6, payload.size),
      ),
    )
  }

  fun parseGetInfoResponse(payload: ByteArray): RefloatConfigProtocolResult<RefloatPackageInfo> {
    val offset = when (val result = appCommandOffset(payload, REFLOAT_GET_INFO)) {
      is RefloatConfigProtocolResult.Success -> result.value
      is RefloatConfigProtocolResult.Failure -> return result
    }
    val dataOffset = offset + 1
    if (payload.size <= dataOffset) {
      return RefloatConfigProtocolResult.Failure("Short Refloat info response: 0 bytes")
    }
    val first = payload[dataOffset].toInt() and 0xff
    if (first == 2) return parseGetInfoV2(payload, dataOffset)
    return parseGetInfoV1(payload, dataOffset)
  }

  private fun parseGetInfoV1(
    payload: ByteArray,
    dataOffset: Int,
  ): RefloatConfigProtocolResult<RefloatPackageInfo> {
    if (payload.size < dataOffset + 3) {
      return RefloatConfigProtocolResult.Failure(
        "Short Refloat info v1 response: ${payload.size - dataOffset} bytes",
      )
    }
    val versionCode = payload[dataOffset].toInt() and 0xff
    val major = versionCode / 10
    val minor = versionCode % 10
    return RefloatConfigProtocolResult.Success(RefloatPackageInfo("Refloat $major.$minor"))
  }

  private fun parseGetInfoV2(
    payload: ByteArray,
    dataOffset: Int,
  ): RefloatConfigProtocolResult<RefloatPackageInfo> {
    val minLength = dataOffset + 2 + 20 + 3
    if (payload.size < minLength) {
      return RefloatConfigProtocolResult.Failure(
        "Short Refloat info v2 response: ${payload.size - dataOffset} bytes",
      )
    }
    val packageName = displayName(fixedString(payload, dataOffset + 2, 20))
    val major = payload[dataOffset + 22].toInt() and 0xff
    val minor = payload[dataOffset + 23].toInt() and 0xff
    val patch = payload[dataOffset + 24].toInt() and 0xff
    val suffix = if (payload.size >= dataOffset + 45) fixedString(payload, dataOffset + 25, 20) else ""
    val suffixPart = when {
      suffix.isBlank() -> ""
      suffix.startsWith("-") -> suffix
      else -> "-$suffix"
    }
    return RefloatConfigProtocolResult.Success(
      RefloatPackageInfo("$packageName $major.$minor.$patch$suffixPart"),
    )
  }

  private fun fixedString(payload: ByteArray, offset: Int, length: Int): String {
    val end = (offset until (offset + length).coerceAtMost(payload.size))
      .firstOrNull { payload[it] == 0.toByte() }
      ?: (offset + length).coerceAtMost(payload.size)
    return if (end <= offset) "" else String(payload, offset, end - offset, Charsets.UTF_8).trim()
  }

  private fun displayName(raw: String): String {
    if (raw.isBlank()) return "Refloat"
    return raw.substring(0, 1).uppercase() + raw.substring(1)
  }
}
