package expo.modules.vescapecore.replay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * @parity /modules/vescape-core/ios/replay/NoBmsRideReplayTests.swift
 */
class NoBmsRideReplayTest {
  private val jsonl =
    javaClass.classLoader!!.getResourceAsStream("fixtures/replay-thor301.jsonl")!!
      .bufferedReader().readText()

  @Test
  fun realRideHasInboundTrafficButNoBmsFrames() {
    assertTrue("expected recorded rx chunks", ReplayChunkDecoder.rxChunks(jsonl).isNotEmpty())
    assertTrue("no-BMS ride must yield zero BMS frames", ReplayChunkDecoder.bmsFrames(jsonl).isEmpty())
  }

  @Test
  fun noBmsRideKeepsDetectorsSilent() {
    val result = WarningReplayHarness.run(jsonl, configuredSeries = 16)
    assertEquals(0, result.frameCount)
    assertEquals(emptyList<Any>(), result.cellSpreadFindings)
    assertEquals(emptyList<String>(), result.mismatchFindings)
    assertTrue("no BMS data must not assert a healthy session", !result.cellSpreadSessionEndClean)
    assertTrue("no BMS data must not assert a healthy session", !result.mismatchSessionEndClean)
  }
}
