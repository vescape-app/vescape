package expo.modules.vescapecore.config

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The fixture is the real head of a `COMM_GET_MCCONF` response captured from a Floatwheel ADV2 on
 * 2026-08-24, and the expected values are what VESC Tool showed for that board at the same moment.
 * It is the only check that the generated offsets describe an actual blob rather than our reading of
 * firmware source.
 */
class McconfDecoderTest {
  private val boardHead = hexToBytes(
    "3f829cf70100020043200000c3200000428c0000c23400002710003243700000c68ca000468ca000" +
      "1f404396000044bb8000017c03ca021c01f403e8044c004650505a0000003225",
  )

  @Test
  fun `real board blob decodes to the values VESC Tool showed`() {
    // The capture is only the head of the blob, so pad it out to the length 6.05 declares.
    val padded = boardHead.copyOf(477)
    val result = McconfDecoder.decode(padded)
    val decoded = result as? McconfDecodeResult.Decoded
      ?: error("expected a decode, got $result")

    assertEquals(1065524471L, decoded.signature)
    assertEquals("release_6_05", decoded.firmware)

    assertEquals(70.0, decoded.values["l_temp_fet_start"]!!, 0.001)
    assertEquals(80.0, decoded.values["l_temp_fet_end"]!!, 0.001)
    assertEquals(80.0, decoded.values["l_temp_motor_start"]!!, 0.001)
    assertEquals(90.0, decoded.values["l_temp_motor_end"]!!, 0.001)

    // float32_auto and scaled-int16 paths, which the temperature bytes alone would not exercise.
    assertEquals(160.0, decoded.values["l_current_max"]!!, 0.001)
    assertEquals(-160.0, decoded.values["l_current_min"]!!, 0.001)
    assertEquals(70.0, decoded.values["l_in_current_max"]!!, 0.001)
    assertEquals(240.0, decoded.values["l_abs_current_max"]!!, 0.001)
    assertEquals(54.0, decoded.values["l_battery_cut_start"]!!, 0.001)
    assertEquals(50.0, decoded.values["l_battery_cut_end"]!!, 0.001)
  }

  @Test
  fun `unknown signature decodes nothing rather than guessing`() {
    val blob = ByteArray(477)
    blob[0] = 0xDE.toByte()
    blob[1] = 0xAD.toByte()
    blob[2] = 0xBE.toByte()
    blob[3] = 0xEF.toByte()

    val result = McconfDecoder.decode(blob)
    val unknown = result as? McconfDecodeResult.UnknownSignature
      ?: error("expected UnknownSignature, got $result")
    assertEquals(0xDEADBEEFL, unknown.signature)
  }

  @Test
  fun `a blob shorter than its layout is malformed, not partially decoded`() {
    val truncated = boardHead.copyOf(120)
    assertTrue(McconfDecoder.decode(truncated) is McconfDecodeResult.Malformed)
  }

  @Test
  fun `every layout has ascending offsets that fit its declared length`() {
    for ((signature, layout) in McconfLayouts.bySignature) {
      assertEquals(signature, layout.signature)
      var expected = 4 // the signature itself is not a field
      for (field in layout.fields) {
        assertEquals("${layout.firmware} ${field.id}", expected, field.offset)
        expected += field.type.byteSize
      }
      assertEquals(layout.firmware, layout.totalBytes, expected)
    }
  }

  private fun hexToBytes(hex: String): ByteArray =
    ByteArray(hex.length / 2) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
}
