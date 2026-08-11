package expo.modules.vescapecore.config

import expo.modules.vescapecore.connection.BoardTransport
import expo.modules.vescapecore.protocol.COMM_CUSTOM_APP_DATA
import expo.modules.vescapecore.protocol.COMM_FORWARD_CAN
import expo.modules.vescapecore.protocol.COMM_GET_CUSTOM_CONFIG
import expo.modules.vescapecore.protocol.COMM_GET_CUSTOM_CONFIG_XML
import expo.modules.vescapecore.protocol.COMM_SET_CUSTOM_CONFIG
import expo.modules.vescapecore.protocol.REFLOAT_GET_INFO
import expo.modules.vescapecore.protocol.REFLOAT_MAGIC

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RefloatConfigProtocolTest {
  @Test
  fun buildsForwardedGetInfoRequest() {
    val payload = RefloatConfigProtocol.buildGetInfo(transport = BoardTransport.Can(7))

    assertArrayEquals(
      byteArrayOf(
        COMM_FORWARD_CAN.toByte(),
        7,
        COMM_CUSTOM_APP_DATA.toByte(),
        REFLOAT_MAGIC.toByte(),
        REFLOAT_GET_INFO.toByte(),
        1,
      ),
      payload,
    )
  }

  @Test
  fun parsesGetInfoV1Response() {
    val payload = byteArrayOf(
      COMM_CUSTOM_APP_DATA.toByte(),
      REFLOAT_MAGIC.toByte(),
      REFLOAT_GET_INFO.toByte(),
      12,
      1,
      0,
    )

    val parsed = RefloatConfigProtocol.parseGetInfoResponse(payload).success()

    assertEquals("Refloat 1.2", parsed.version)
  }

  @Test
  fun parsesForwardedGetInfoV2Response() {
    val payload = ByteArray(2 + 3 + 2 + 20 + 3 + 20)
    payload[0] = COMM_FORWARD_CAN.toByte()
    payload[1] = 7
    payload[2] = COMM_CUSTOM_APP_DATA.toByte()
    payload[3] = REFLOAT_MAGIC.toByte()
    payload[4] = REFLOAT_GET_INFO.toByte()
    payload[5] = 2
    payload[6] = 0
    "refloat".encodeToByteArray().copyInto(payload, destinationOffset = 7)
    payload[27] = 1
    payload[28] = 3
    payload[29] = 0
    "preview2".encodeToByteArray().copyInto(payload, destinationOffset = 30)

    val parsed = RefloatConfigProtocol.parseGetInfoResponse(payload).success()

    assertEquals("Refloat 1.3.0-preview2", parsed.version)
  }

  @Test
  fun normalizesRefloatBaseVersionFromSuffixesAndForkLabels() {
    assertEquals("1.3.0", RefloatConfigProtocol.normalizeBaseVersion("Refloat 1.3.0-preview2"))
    assertEquals("2.4.1", RefloatConfigProtocol.normalizeBaseVersion("Float Package 2.4.1 fork-a"))
    assertEquals("3.0.7", RefloatConfigProtocol.normalizeBaseVersion("vesc-tool-refloat-3.0.7+local"))
    assertEquals("1.1", RefloatConfigProtocol.normalizeBaseVersion("Refloat 1.1"))
  }

  @Test
  fun normalizeRefloatBaseVersionReturnsNullWhenVersionIsIncomplete() {
    assertNull(RefloatConfigProtocol.normalizeBaseVersion("Refloat 1"))
    assertNull(RefloatConfigProtocol.normalizeBaseVersion(""))
    assertNull(RefloatConfigProtocol.normalizeBaseVersion(null))
  }

  @Test
  fun buildsForwardedCustomConfigXmlRequest() {
    val payload = RefloatConfigProtocol.buildGetCustomConfigXml(
      transport = BoardTransport.Can(7),
      confInd = 0,
      length = 384,
      offset = 768,
    )

    assertArrayEquals(
      byteArrayOf(
        COMM_FORWARD_CAN.toByte(),
        7,
        COMM_GET_CUSTOM_CONFIG_XML.toByte(),
        0,
        0, 0, 1, 0x80.toByte(),
        0, 0, 3, 0,
      ),
      payload,
    )
  }

  @Test
  fun buildsForwardedCustomConfigRequest() {
    val payload = RefloatConfigProtocol.buildGetCustomConfig(transport = BoardTransport.Can(7), confInd = 0)

    assertArrayEquals(
      byteArrayOf(
        COMM_FORWARD_CAN.toByte(),
        7,
        COMM_GET_CUSTOM_CONFIG.toByte(),
        0,
      ),
      payload,
    )
  }

  @Test
  fun parsesCustomConfigXmlResponse() {
    val payload = byteArrayOf(
      COMM_GET_CUSTOM_CONFIG_XML.toByte(),
      0,
      0, 0, 0, 10,
      0, 0, 0, 4,
      't'.code.toByte(),
      'e'.code.toByte(),
      's'.code.toByte(),
      't'.code.toByte(),
    )

    val parsed = RefloatConfigProtocol.parseCustomConfigXmlResponse(payload).success()

    assertEquals(0, parsed.confInd)
    assertEquals(10, parsed.totalLength)
    assertEquals(4, parsed.offset)
    assertArrayEquals("test".encodeToByteArray(), parsed.chunk)
  }

  @Test
  fun parsesForwardedCustomConfigXmlResponse() {
    val payload = byteArrayOf(
      COMM_FORWARD_CAN.toByte(),
      7,
      COMM_GET_CUSTOM_CONFIG_XML.toByte(),
      0,
      0, 0, 0, 10,
      0, 0, 0, 4,
      't'.code.toByte(),
      'e'.code.toByte(),
      's'.code.toByte(),
      't'.code.toByte(),
    )

    val parsed = RefloatConfigProtocol.parseCustomConfigXmlResponse(payload).success()

    assertEquals(0, parsed.confInd)
    assertEquals(10, parsed.totalLength)
    assertEquals(4, parsed.offset)
    assertArrayEquals("test".encodeToByteArray(), parsed.chunk)
  }

  @Test
  fun ignoresWrongXmlCommandResponse() {
    val payload = byteArrayOf(COMM_GET_CUSTOM_CONFIG.toByte(), 0)
    val failure = RefloatConfigProtocol.parseCustomConfigXmlResponse(payload).failure()
    assertEquals("Unexpected Refloat config command 93, expected 92", failure.message)
  }

  @Test
  fun parsesCustomConfigResponse() {
    val payload = byteArrayOf(
      COMM_GET_CUSTOM_CONFIG.toByte(),
      0,
      0x12,
      0x34,
      0x56,
      0x78,
      1,
      2,
      3,
      4,
    )
    val parsed = RefloatConfigProtocol.parseCustomConfigResponse(payload).success()
    assertEquals(0, parsed.confInd)
    assertEquals(0x12345678L, parsed.packageSignature)
    assertArrayEquals(byteArrayOf(1, 2, 3, 4), parsed.config)
  }

  @Test
  fun parsesForwardedCustomConfigResponse() {
    val payload = byteArrayOf(
      COMM_FORWARD_CAN.toByte(),
      7,
      COMM_GET_CUSTOM_CONFIG.toByte(),
      0,
      0x12,
      0x34,
      0x56,
      0x78,
      1,
      2,
      3,
      4,
    )
    val parsed = RefloatConfigProtocol.parseCustomConfigResponse(payload).success()
    assertEquals(0, parsed.confInd)
    assertEquals(0x12345678L, parsed.packageSignature)
    assertArrayEquals(byteArrayOf(1, 2, 3, 4), parsed.config)
  }

  @Test
  fun rejectsShortForwardedXmlResponseWithSpecificMessage() {
    val failure = RefloatConfigProtocol
      .parseCustomConfigXmlResponse(byteArrayOf(COMM_FORWARD_CAN.toByte(), 7))
      .failure()

    assertEquals("Short forwarded Refloat config response", failure.message)
  }

  @Test
  fun rejectsXmlResponseWithWrongConfigIndex() {
    val payload = byteArrayOf(
      COMM_GET_CUSTOM_CONFIG_XML.toByte(),
      1,
      0, 0, 0, 10,
      0, 0, 0, 4,
      't'.code.toByte(),
      'e'.code.toByte(),
      's'.code.toByte(),
      't'.code.toByte(),
    )

    val failure = RefloatConfigProtocol.parseCustomConfigXmlResponse(payload).failure()

    assertEquals("Unexpected Refloat config XML index 1", failure.message)
  }

  @Test
  fun rejectsXmlChunkThatExceedsDeclaredLength() {
    val payload = byteArrayOf(
      COMM_GET_CUSTOM_CONFIG_XML.toByte(),
      0,
      0, 0, 0, 6,
      0, 0, 0, 4,
      't'.code.toByte(),
      'e'.code.toByte(),
      's'.code.toByte(),
    )

    val failure = RefloatConfigProtocol.parseCustomConfigXmlResponse(payload).failure()

    assertEquals("Refloat config XML chunk exceeds length: offset=4 chunk=3 length=6", failure.message)
  }

  @Test
  fun rejectsConfigResponseWithWrongConfigIndex() {
    val failure = RefloatConfigProtocol
      .parseCustomConfigResponse(byteArrayOf(COMM_GET_CUSTOM_CONFIG.toByte(), 1, 0, 0, 0, 0))
      .failure()

    assertEquals("Unexpected Refloat config index 1", failure.message)
  }

  @Test
  fun buildsForwardedSetCustomConfigRequest() {
    val configBytes = byteArrayOf(0x01, 0x02, 0x03, 0x04)
    val payload = RefloatConfigProtocol.buildSetCustomConfig(
      transport = BoardTransport.Can(7),
      confInd = 0,
      packageSignature = 0x12345678L,
      configBytes = configBytes,
    )

    assertArrayEquals(
      byteArrayOf(
        COMM_FORWARD_CAN.toByte(),
        7,
        COMM_SET_CUSTOM_CONFIG.toByte(),
        0,
        0x12,
        0x34,
        0x56,
        0x78,
        1, 2, 3, 4,
      ),
      payload,
    )
  }

  @Test
  fun parsesSetCustomConfigResponse() {
    val payload = byteArrayOf(COMM_SET_CUSTOM_CONFIG.toByte())
    val confInd = RefloatConfigProtocol.parseSetCustomConfigResponse(payload).success()
    assertEquals(0, confInd)
  }

  @Test
  fun parsesForwardedSetCustomConfigResponse() {
    val payload = byteArrayOf(COMM_FORWARD_CAN.toByte(), 7, COMM_SET_CUSTOM_CONFIG.toByte())
    val confInd = RefloatConfigProtocol.parseSetCustomConfigResponse(payload).success()
    assertEquals(0, confInd)
  }

  @Test
  fun rejectsSetConfigResponseWithWrongIndex() {
    val failure = RefloatConfigProtocol
      .parseSetCustomConfigResponse(byteArrayOf(COMM_SET_CUSTOM_CONFIG.toByte(), 1))
      .failure()
    assertEquals("Unexpected Refloat set config index 1", failure.message)
  }

  @Test
  fun parsesLegacySetConfigResponseWithConfigIndex() {
    val confInd = RefloatConfigProtocol
      .parseSetCustomConfigResponse(byteArrayOf(COMM_SET_CUSTOM_CONFIG.toByte(), 0))
      .success()
    assertEquals(0, confInd)
  }

  // --- Direct connection tests ---

  @Test
  fun buildsDirectCustomConfigXmlRequest() {
    val payload = RefloatConfigProtocol.buildGetCustomConfigXml(
      transport = BoardTransport.Direct,
      confInd = 0,
      length = 384,
      offset = 768,
    )

    assertArrayEquals(
      byteArrayOf(
        COMM_GET_CUSTOM_CONFIG_XML.toByte(),
        0,
        0, 0, 1, 0x80.toByte(),
        0, 0, 3, 0,
      ),
      payload,
    )
  }

  @Test
  fun buildsDirectCustomConfigRequest() {
    val payload = RefloatConfigProtocol.buildGetCustomConfig(transport = BoardTransport.Direct, confInd = 0)

    assertArrayEquals(
      byteArrayOf(
        COMM_GET_CUSTOM_CONFIG.toByte(),
        0,
      ),
      payload,
    )
  }

  @Test
  fun buildsDirectSetCustomConfigRequest() {
    val configBytes = byteArrayOf(0x01, 0x02, 0x03, 0x04)
    val payload = RefloatConfigProtocol.buildSetCustomConfig(
      transport = BoardTransport.Direct,
      confInd = 0,
      packageSignature = 0x12345678L,
      configBytes = configBytes,
    )

    assertArrayEquals(
      byteArrayOf(
        COMM_SET_CUSTOM_CONFIG.toByte(),
        0,
        0x12,
        0x34,
        0x56,
        0x78,
        1, 2, 3, 4,
      ),
      payload,
    )
  }

  @Test
  fun forwardedBuildStillWorksWithExplicitCanId() {
    val payload = RefloatConfigProtocol.buildGetCustomConfig(transport = BoardTransport.Can(7), confInd = 0)
    assertArrayEquals(
      byteArrayOf(
        COMM_FORWARD_CAN.toByte(),
        7,
        COMM_GET_CUSTOM_CONFIG.toByte(),
        0,
      ),
      payload,
    )
  }

  @Test
  fun directXmlRequestHasCorrectSize() {
    val payload = RefloatConfigProtocol.buildGetCustomConfigXml(
      transport = BoardTransport.Direct,
      confInd = 0,
      length = 100,
      offset = 0,
    )
    assertEquals(10, payload.size)
  }

  @Test
  fun forwardedXmlRequestHasCorrectSize() {
    val payload = RefloatConfigProtocol.buildGetCustomConfigXml(
      transport = BoardTransport.Can(7),
      confInd = 0,
      length = 100,
      offset = 0,
    )
    assertEquals(12, payload.size)
  }

  private fun <T> RefloatConfigProtocolResult<T>.success(): T {
    assertTrue(this is RefloatConfigProtocolResult.Success)
    return (this as RefloatConfigProtocolResult.Success<T>).value
  }

  private fun <T> RefloatConfigProtocolResult<T>.failure(): RefloatConfigProtocolResult.Failure {
    assertTrue(this is RefloatConfigProtocolResult.Failure)
    return this as RefloatConfigProtocolResult.Failure
  }
}
