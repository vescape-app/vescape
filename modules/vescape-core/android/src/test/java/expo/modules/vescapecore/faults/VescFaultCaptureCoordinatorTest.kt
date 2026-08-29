package expo.modules.vescapecore.faults

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * VESC Fault Capture window rules: a five-second pre-roll copied from the recent decoded window and
 * persisted at open, appends at the achieved response rate, a two-second post-clear tail bounded by
 * timestamps rather than sample counts, overlapping captures that intentionally duplicate samples,
 * and a session end that keeps what exists without fabricating a clear.
 * @parity /modules/vescape-core/ios/faults/VescFaultCaptureCoordinatorTests.swift
 */
class VescFaultCaptureCoordinatorTest {
  private class FakeStore : VescFaultCaptureStore {
    val captures = LinkedHashMap<String, VescFaultCapture>()
    val samples = LinkedHashMap<String, MutableList<VescFaultCaptureSample>>()
    var appendCalls = 0

    override suspend fun upsertCapture(capture: VescFaultCapture) {
      captures[capture.occurrenceId] = capture
    }

    override suspend fun appendSamples(occurrenceId: String, samples: List<VescFaultCaptureSample>) {
      appendCalls += 1
      this.samples.getOrPut(occurrenceId) { mutableListOf() }.addAll(samples)
    }

    override suspend fun getCapture(occurrenceId: String) = captures[occurrenceId]

    override suspend fun getSamples(occurrenceId: String) = samples[occurrenceId].orEmpty()
  }

  private val store = FakeStore()
  private val coordinator = VescFaultCaptureCoordinator(store)

  /** A decoded live-window row, as `TelemetryPipeline` shapes it. */
  private fun tick(atMs: Long, speed: Double = 20.0): Map<String, Any?> = mapOf(
    "lastPacketAt" to atMs,
    "speed" to speed,
    "dutyCycle" to 0.5,
    "state" to 4,
  )

  private fun window(vararg ticks: Map<String, Any?>) {
    coordinator.recentWindow = { ticks.toList() }
  }

  private fun feed(atMs: Long) = coordinator.observeSample(BOARD, tick(atMs))

  private fun samplesOf(id: String) = store.samples[id].orEmpty()

  @Test
  fun `open persists exactly the five seconds preceding detection`() = runBlocking {
    // 10s of live window at 100ms; only the last 5s belong to the capture.
    window(*(0..100).map { tick(OPEN - 10_000 + it * 100L) }.toTypedArray())

    coordinator.openCapture("occ", BOARD, OPEN)

    val prefix = samplesOf("occ")
    assertEquals(OPEN - 5_000, prefix.first().capturedAtMs)
    assertEquals(OPEN, prefix.last().capturedAtMs)
    assertEquals(51, prefix.size)
    // Persisted before any append, so a process kill still leaves the run-up on disk.
    assertEquals(51, store.captures["occ"]?.sampleCount)
    assertNull(store.captures["occ"]?.endedAtMs)
  }

  @Test
  fun `capture opens empty when no live window is wired`() = runBlocking {
    coordinator.openCapture("occ", BOARD, OPEN)

    assertEquals(0, store.captures["occ"]?.sampleCount)
    assertTrue(samplesOf("occ").isEmpty())
  }

  @Test
  fun `appends every received sample at the achieved rate`() = runBlocking {
    window()
    coordinator.openCapture("occ", BOARD, OPEN)
    // Deliberately irregular: response-paced polling, not a 30 Hz cadence.
    for (offset in listOf(20L, 25L, 300L, 900L, 1_500L)) feed(OPEN + offset)
    coordinator.flush()

    assertEquals(
      listOf(20L, 25L, 300L, 900L, 1_500L).map { OPEN + it },
      samplesOf("occ").map { it.capturedAtMs },
    )
  }

  @Test
  fun `samples for another board never enter the window`() = runBlocking {
    window()
    coordinator.openCapture("occ", BOARD, OPEN)
    coordinator.observeSample("other-board", tick(OPEN + 100))
    coordinator.flush()

    assertTrue(samplesOf("occ").isEmpty())
  }

  @Test
  fun `tail keeps two seconds after clear then retires the window`() = runBlocking {
    window()
    coordinator.openCapture("occ", BOARD, OPEN)
    feed(OPEN + 500)
    coordinator.closeCapture("occ", OPEN + 1_000)
    feed(OPEN + 2_999) // inside the tail
    feed(OPEN + 3_000) // exactly on the boundary, still inside
    feed(OPEN + 3_001) // past it: retires the window, and is not retained
    coordinator.flush()

    assertEquals(
      listOf(500L, 2_999L, 3_000L).map { OPEN + it },
      samplesOf("occ").map { it.capturedAtMs },
    )
    val capture = store.captures.getValue("occ")
    assertEquals(OPEN + 3_000, capture.endedAtMs)
    assertTrue(capture.complete)

    // Retired: later samples cannot reopen it.
    feed(OPEN + 4_000)
    coordinator.flush()
    assertEquals(3, samplesOf("occ").size)
  }

  @Test
  fun `overlapping captures duplicate samples and stay independent`() = runBlocking {
    window()
    coordinator.openCapture("a", BOARD, OPEN)
    feed(OPEN + 100)
    // Direct A-to-B code change: A starts its tail while B opens its own window.
    coordinator.closeCapture("a", OPEN + 200)
    coordinator.flush()
    coordinator.recentWindow = { listOf(tick(OPEN + 100), tick(OPEN + 200)) }
    coordinator.openCapture("b", BOARD, OPEN + 200)
    feed(OPEN + 300)
    feed(OPEN + 1_000)
    coordinator.flush()

    // The shared 300ms/1000ms samples belong to both captures.
    assertEquals(listOf(100L, 300L, 1_000L).map { OPEN + it }, samplesOf("a").map { it.capturedAtMs })
    assertEquals(
      listOf(100L, 200L, 300L, 1_000L).map { OPEN + it },
      samplesOf("b").map { it.capturedAtMs },
    )
    // Still two separate windows with their own boundaries.
    assertEquals(OPEN - 5_000, store.captures.getValue("a").startedAtMs)
    assertEquals(OPEN - 4_800, store.captures.getValue("b").startedAtMs)
  }

  @Test
  fun `session end keeps evidence without fabricating a clear`() = runBlocking {
    window()
    coordinator.openCapture("occ", BOARD, OPEN)
    feed(OPEN + 400)
    coordinator.onSessionEnded(BOARD)

    val capture = store.captures.getValue("occ")
    assertEquals(listOf(OPEN + 400), samplesOf("occ").map { it.capturedAtMs })
    assertEquals(OPEN + 400, capture.endedAtMs)
    // Never complete: the controller never reported a clear, so no tail was observed.
    assertFalse(capture.complete)
  }

  @Test
  fun `session end mid-tail marks the capture incomplete`() = runBlocking {
    window()
    coordinator.openCapture("occ", BOARD, OPEN)
    coordinator.closeCapture("occ", OPEN + 1_000)
    feed(OPEN + 1_100)
    coordinator.onSessionEnded(BOARD)

    assertFalse(store.captures.getValue("occ").complete)
  }

  @Test
  fun `session end only finalizes the ending board`() = runBlocking {
    window()
    coordinator.openCapture("mine", BOARD, OPEN)
    coordinator.openCapture("theirs", "other-board", OPEN)
    coordinator.onSessionEnded("other-board")
    feed(OPEN + 100)
    coordinator.flush()

    assertEquals(listOf(OPEN + 100), samplesOf("mine").map { it.capturedAtMs })
    assertNull(store.captures.getValue("mine").endedAtMs)
  }

  @Test
  fun `untimestamped rows are not placed in a window`() = runBlocking {
    // A mode-69 fault frame carries no metric values and no packet time: it must not become a
    // fake all-zero sample. The occurrence timing carries the observation instead.
    window(mapOf("speed" to 0.0, "dutyCycle" to 0.0))
    coordinator.openCapture("occ", BOARD, OPEN)
    assertFalse(coordinator.observeSample(BOARD, mapOf("speed" to 0.0)))
    coordinator.flush()

    assertTrue(samplesOf("occ").isEmpty())
  }

  @Test
  fun `sampling stays memory-only until a window asks for a flush`() = runBlocking {
    window()
    coordinator.openCapture("occ", BOARD, OPEN)
    store.appendCalls = 0
    // Runs on the BLE hot path: buffered samples reach the database only through `flush`.
    assertFalse(feed(OPEN + 10))
    assertEquals(0, store.appendCalls)

    coordinator.flush()
    assertEquals(1, store.appendCalls)
  }

  private companion object {
    const val BOARD = "board-1"
    const val OPEN = 1_700_000_000_000L
  }
}
