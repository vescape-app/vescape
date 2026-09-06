package expo.modules.vescapecore.faults

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** @parity /modules/vescape-core/ios/faults/VescFaultCaptureCoordinatorTests.swift */
class VescFaultCaptureCoordinatorTest {
  private class FakeStore : VescFaultCaptureStore {
    val captures = LinkedHashMap<String, VescFaultCapture>()
    val samples = LinkedHashMap<String, List<VescFaultCaptureSample>>()

    override suspend fun upsertCapture(capture: VescFaultCapture) {
      captures[capture.occurrenceId] = capture
    }

    override suspend fun appendSamples(occurrenceId: String, samples: List<VescFaultCaptureSample>) {
      this.samples[occurrenceId] = samples
    }

    override suspend fun getCapture(occurrenceId: String) = captures[occurrenceId]
    override suspend fun getSamples(occurrenceId: String) = samples[occurrenceId].orEmpty()
  }

  private fun tick(atMs: Long): Map<String, Any?> = mapOf("lastPacketAt" to atMs, "speed" to 20.0)

  @Test
  fun `captures only the five seconds before detection`() = runBlocking {
    val store = FakeStore()
    val coordinator = VescFaultCaptureCoordinator(store)
    coordinator.recentWindow = { listOf(tick(OPEN - 5_001), tick(OPEN - 5_000), tick(OPEN), tick(OPEN + 1)) }

    coordinator.capturePast("occ", "board", OPEN)

    assertEquals(listOf(OPEN - 5_000, OPEN), store.samples.getValue("occ").map { it.capturedAtMs })
    assertEquals(2, store.captures.getValue("occ").sampleCount)
  }

  @Test
  fun `missing recent telemetry creates an empty completed capture`() = runBlocking {
    val store = FakeStore()
    VescFaultCaptureCoordinator(store).capturePast("occ", "board", OPEN)

    assertEquals(0, store.captures.getValue("occ").sampleCount)
  }

  @Test
  fun `collection off creates nothing`() = runBlocking {
    val store = FakeStore()
    val coordinator = VescFaultCaptureCoordinator(store)
    coordinator.setCollectionEnabled(false)
    coordinator.capturePast("occ", "board", OPEN)

    assertTrue(store.captures.isEmpty())
  }

  private companion object {
    const val OPEN = 1_700_000_000_000L
  }
}
