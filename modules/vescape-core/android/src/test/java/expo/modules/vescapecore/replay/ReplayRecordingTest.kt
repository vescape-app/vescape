package expo.modules.vescapecore.replay

import expo.modules.vescapecore.connection.BoardTransport
import expo.modules.vescapecore.protocol.COMM_CUSTOM_APP_DATA
import expo.modules.vescapecore.protocol.REFLOAT_GET_INFO

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * @parity /modules/vescape-core/ios/replay/ReplayRecordingTests.swift
 */
class ReplayRecordingTest {
  private fun fixture(name: String): String =
    javaClass.classLoader!!.getResourceAsStream("fixtures/$name")!!.bufferedReader().readText()

  @Test
  fun recordedRideCarriesItsOwnHardwareIdentity() {
    val recording = ReplayRecording.parse("replay-thor301.jsonl", fixture("replay-thor301.jsonl"))
    val hardware = recording.hardware

    assertEquals(BoardTransport.Can(98), hardware.transport)
    assertFalse(hardware.firmware.isNullOrBlank())
    assertFalse(hardware.refloatVersion.isNullOrBlank())
    assertFalse("a ride with no BMS replies has no BMS", hardware.hasBms)
    assertEquals(50L, hardware.pollIntervalMs)
  }

  @Test
  fun repliesAreIndexedByWhatTheyAnswer() {
    val recording = ReplayRecording.parse("replay-thor301.jsonl", fixture("replay-thor301.jsonl"))
    val book = recording.replies

    assertNotNull(book.firmware)
    assertNotNull(book.refloatInfo)
    val xml = book.configXml.getValue(0)
    assertTrue(xml.isNotEmpty())
    assertTrue("reassembled XML must be fully covered", xml.last() != 0.toByte())
    assertTrue(book.configSnapshots.getValue(0).isNotEmpty())
    assertTrue(
      recording.timeline.none { event ->
        event is ReplayEvent.Frame &&
          (event.payload[0].toInt() and 0xff) == COMM_CUSTOM_APP_DATA &&
          ReplayRecording.refloatCommand(event.payload) == REFLOAT_GET_INFO
      },
    )
    assertTrue(recording.timeline.zipWithNext().all { (a, b) -> a.t <= b.t })
  }

  @Test
  fun recordingWithoutTxTakesTheHopFromItsMeta() {
    val recording = ReplayRecording.parse("replay-thor301-1hz.jsonl", fixture("replay-thor301-1hz.jsonl"))

    assertEquals(BoardTransport.Can(98), recording.hardware.transport)
    assertTrue(recording.timeline.any { it is ReplayEvent.Fix })
  }
}
