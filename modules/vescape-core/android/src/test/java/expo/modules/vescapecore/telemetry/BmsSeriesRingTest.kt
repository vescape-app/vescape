package expo.modules.vescapecore.telemetry

import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BmsSeriesRingTest {
  private val windowMs = 5 * 60_000L

  @Test
  fun trimsFramesOlderThanWindow() {
    val ring = BmsSeriesRing()
    ring.append(1_000L, listOf(3.9, 3.9), listOf(false, false), windowMs)
    ring.append(2_000L, listOf(4.0, 4.0), listOf(false, false), windowMs)
    ring.append(2_000L + windowMs, listOf(4.1, 4.1), listOf(false, false), windowMs)
    val frames = ring.snapshot(windowMs, 2_000L + windowMs)
    assertEquals(listOf(2_000L, 2_000L + windowMs), frames.map { it.capturedAtMs })
  }

  @Test
  fun snapshotFiltersByWindowWithoutNewAppends() {
    val ring = BmsSeriesRing()
    ring.append(1_000L, listOf(3.9), listOf(false), windowMs)
    ring.append(5_000L, listOf(4.0), listOf(false), windowMs)
    val frames = ring.snapshot(windowMs, 4_000L + windowMs)
    assertEquals(listOf(5_000L), frames.map { it.capturedAtMs })
  }

  @Test
  fun cellCountChangeResetsRing() {
    val ring = BmsSeriesRing()
    ring.append(1_000L, listOf(3.9, 3.9), listOf(false, false), windowMs)
    ring.append(2_000L, listOf(4.0, 4.0, 4.0), listOf(false, false, false), windowMs)
    assertEquals(3, ring.cellCount())
    assertEquals(listOf(2_000L), ring.snapshot(windowMs, 2_000L).map { it.capturedAtMs })
  }

  @Test
  fun rejectsFrameWithoutCells() {
    val ring = BmsSeriesRing()
    assertNull(ring.append(1_000L, emptyList(), emptyList(), windowMs))
    assertEquals(0, ring.cellCount())
  }

  @Test
  fun encodesColumnsWithSplitBalancingBitmask() {
    val ring = BmsSeriesRing()
    val voltages = List(32) { 3.5 + it * 0.01 }
    val balancing = List(32) { it == 0 || it == 31 }
    ring.append(1_000L, voltages, balancing, windowMs)
    val frames = ring.snapshot(windowMs, 1_000L)
    val buffer = encodeBmsSeriesColumns(frames, ring.cellCount())
    val lanes = buffer.order(ByteOrder.LITTLE_ENDIAN).asDoubleBuffer()
    assertEquals(BMS_SERIES_FIXED_LANES + 32, lanes.capacity())
    assertEquals(1_000.0, lanes.get(0), 0.0)
    assertEquals(1.0, lanes.get(1), 0.0)
    assertEquals(2.0, lanes.get(2), 0.0)
    assertEquals(3.5, lanes.get(BMS_SERIES_FIXED_LANES), 1e-9)
    assertEquals(3.81, lanes.get(BMS_SERIES_FIXED_LANES + 31), 1e-9)
  }
}
