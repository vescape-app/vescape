package expo.modules.vescapecore

import expo.modules.vescapecore.telemetry.LiveSeriesDownsampler
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveSeriesDownsamplerTest {

    private data class Row(val ts: Long, val v: Double?)

    private fun run(rows: List<Row>, buckets: Int, windowMs: Long): DoubleArray =
        LiveSeriesDownsampler.downsampleMinMax(rows, buckets, windowMs, { it.ts }, { it.v })

    private fun values(out: DoubleArray): List<Double> = (1 until out.size step 2).map { out[it] }

    private fun points(out: DoubleArray): List<Pair<Long, Double>> =
        (0 until out.size step 2).map { out[it].toLong() to out[it + 1] }

    @Test
    fun `empty input yields empty array`() {
        assertEquals(0, run(emptyList(), 8, 40L).size)
    }

    @Test
    fun `non-positive window yields empty array`() {
        assertEquals(0, run(listOf(Row(0, 1.0)), 8, 0L).size)
    }

    @Test
    fun `preserves bucket peaks and troughs while reducing point count`() {
        val rows = (0 until 40).map { Row(it.toLong(), 0.0) }.toMutableList()
        rows[10] = Row(10, 100.0)
        rows[25] = Row(25, -50.0)

        val out = run(rows, 4, 40L)
        val vals = values(out)

        assertTrue("decimated below input", out.size / 2 < rows.size)
        assertEquals(100.0, vals.max(), 0.0)
        assertEquals(-50.0, vals.min(), 0.0)
    }

    @Test
    fun `emits points in chronological order`() {
        val ramp = listOf(0, 1, 2, 3, 4, 5, 4, 3, 2, 1).mapIndexed { i, v -> Row(i.toLong(), v.toDouble()) }
        val out = run(ramp, 2, 10L)
        for (i in 2 until out.size step 2) {
            assertTrue("timestamps non-decreasing", out[i] >= out[i - 2])
        }
    }

    @Test
    fun `skips null and non-finite values`() {
        val rows = (0 until 30).map {
            Row(it.toLong(), if (it == 5) null else if (it == 6) Double.NaN else it.toDouble())
        }
        val vals = values(run(rows, 3, 30L))
        assertTrue(vals.none { it.isNaN() })
        assertEquals(29.0, vals.max(), 0.0)
    }

    @Test
    fun `single-timestamp window collapses to min and max`() {
        val rows = listOf(Row(1000, 3.0), Row(1000, 9.0), Row(1000, 1.0))
        val vals = values(run(rows, 8, 8000L))
        assertEquals(1.0, vals.min(), 0.0)
        assertEquals(9.0, vals.max(), 0.0)
    }

    @Test
    fun `shared buckets are identical across sliding windows`() {
        val buckets = 5
        val windowMs = 50L
        val older = (0L..49L).map { Row(it, (it % 7).toDouble()) }
        val newer = (20L..69L).map { Row(it, (it % 7).toDouble()) }

        val a = points(run(older, buckets, windowMs)).filter { it.first in 30..39 }
        val b = points(run(newer, buckets, windowMs)).filter { it.first in 30..39 }

        assertEquals(a, b)
        assertTrue("bucket 30..39 emitted", a.isNotEmpty())
    }
}
