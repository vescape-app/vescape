package expo.modules.vescapecore.faults

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** @parity /modules/vescape-core/ios/faults/VescFaultLogReaderTests.swift */
class VescFaultLogReaderTest {
  @Test
  fun `joins chunks and completes after silence`() {
    var output: String? = null
    val reader = VescFaultLogReader(1_000, { output = it }, { _, _ -> error("unexpected") })
    reader.onPrintChunk("Faults:\n".toByteArray(), 1_100)
    reader.onPrintChunk("NONE\n".toByteArray(), 1_200)

    assertFalse(reader.poll(1_699))
    assertTrue(reader.poll(1_700))
    assertEquals("Faults:\nNONE\n", output)
  }

  @Test
  fun `times out when controller prints nothing`() {
    var code: String? = null
    val reader = VescFaultLogReader(1_000, { error("unexpected") }, { value, _ -> code = value })

    assertTrue(reader.poll(5_000))
    assertEquals("VESC_FAULT_LOG_TIMEOUT", code)
  }

  @Test
  fun `disconnect cancels the read`() {
    var code: String? = null
    val reader = VescFaultLogReader(1_000, { error("unexpected") }, { value, _ -> code = value })

    reader.cancel()
    assertEquals("VESC_FAULT_LOG_DISCONNECTED", code)
  }
}
