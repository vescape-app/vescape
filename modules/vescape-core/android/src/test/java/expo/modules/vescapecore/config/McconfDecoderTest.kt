package expo.modules.vescapecore.config

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The fixture is a complete `COMM_GET_MCCONF` response captured from a Thor301 on
 * 2026-08-24, and the expected values are what VESC Tool showed for that board at the same moment.
 * It is the only check that the generated offsets describe an actual blob rather than our reading of
 * firmware source.
 */
class McconfDecoderTest {
  private val boardBlob = hexToBytes(
      "3f829cf70100020043200000c3200000428c0000c23400002710003243700000" +
      "c68ca000468ca0001f404396000044bb8000017c03ca021c01f403e8044c0046" +
      "50505a00000032251c49b71b00c9b71b00271027102710431600004489800041" +
      "200000026c1f40479c400044160000ff010302050604ff44fa00003e20c49c42" +
      "33999a46dac0003df5c28f004334000040e000000244fa000046ea600039244f" +
      "d63861a74f3d37e9103cf765fe490647003d4ccccdfc1842480000447a000027" +
      "10451c4000442f00000000038400c8000a0000000a00050000ff9cff8902ab44" +
      "6723ff437a000044e1000044fa00000000020000010a3103e8000200c8002800" +
      "3c012c00960000453b800000053a83126f010044fee3854500402944ff21ecff" +
      "f5001dffee0000000000000101457a00000042200000196401f400c80000053b" +
      "83126f3b83126f38d1b71707d0446100000146c35000003ccccccd0000000000" +
      "00000039b7803407d03f80000000000000000000643d4ccccd3b96bb99019000" +
      "00003200c83f0000000000200003e803e80672067201f4000000000010453b80" +
      "004708b80046c350004553400000003f1c28f603e800fa032d1e3f8000003e9c" +
      "ac08001440c000003f80000000002d41003200000b5409c4106810cc00",
  )

  @Test
  fun `real board blob decodes to the values VESC Tool showed`() {
    val result = McconfDecoder.decode(boardBlob)
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

    // Tail fields, which a misaligned layout would corrupt long before reaching them.
    assertEquals(8192.0, decoded.values["m_encoder_counts"]!!, 0.001)
    assertEquals(50.0, decoded.values["m_fault_stop_time_ms"]!!, 0.001)
    assertEquals(3380.0, decoded.values["m_ntc_motor_beta"]!!, 0.001)
    assertEquals(30.0, decoded.values["si_motor_poles"]!!, 0.001)
    assertEquals(0.306, decoded.values["si_wheel_diameter"]!!, 0.001)
    assertEquals(20.0, decoded.values["si_battery_cells"]!!, 0.001)
    assertEquals(45.0, decoded.values["bms.t_limit_start"]!!, 0.001)
    assertEquals(2.9, decoded.values["bms.vmin_limit_start"]!!, 0.001)
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
    val truncated = boardBlob.copyOf(120)
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
