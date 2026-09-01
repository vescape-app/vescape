package expo.modules.vescapecore.hardware

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SensorLogTest {
    @Test
    fun `keeps numbers and refuses console chatter`() {
        val log = SensorLog()
        assertTrue(log.append("""{"seq":1,"distanceMm":100,"name":"hw"}""", 1_000L))
        assertFalse(log.append("rate: 10.0 Hz", 1_010L))
        assertFalse(log.append("{}", 1_020L))
        assertEquals(listOf("seq", "distanceMm"), log.keys())
    }

    @Test
    fun `reports the delivered rate and the frames the link lost`() {
        val log = SensorLog()
        // Ten frames a second, with sequence 3 never arriving.
        log.append("""{"seq":1,"readMs":4}""", 1_000L)
        log.append("""{"seq":2,"readMs":4}""", 1_100L)
        log.append("""{"seq":4,"readMs":5}""", 1_200L)
        val rate = log.rate()
        assertEquals(10.0, rate.hz!!, 0.01)
        assertEquals(1, rate.dropped)
        assertEquals(5.0, rate.readMs!!, 0.0)
    }

    @Test
    fun `scales and clamps into display units`() {
        val log = SensorLog()
        log.append("""{"distanceMm":8190,"rangeCm":-2,"upMs":5000}""", 1_000L)
        assertEquals(listOf(40.0, 0.0, 5.0), log.live().toList())
    }

    @Test
    fun `holds a ranged sensor at its ceiling but invents no history before it answered`() {
        val log = SensorLog()
        log.append("""{"rangeCm":12}""", 1_000L)
        log.append("""{"distanceMm":100}""", 1_100L)
        log.append("""{"distanceMm":120,"rangeCm":14}""", 1_200L)
        val series = log.series().associateBy { it.key }

        // Row order is the link's, so a sensor dropping out and returning cannot move the rows.
        assertEquals(listOf("rangeCm", "distanceMm"), log.series().map { it.key })
        // The ToF had not answered at 1000, so nothing is drawn there; the ranger rides its
        // ceiling through the frame it missed.
        assertEquals(listOf(1_100.0, 10.0, 1_200.0, 12.0), series["distanceMm"]!!.points.toList())
        assertEquals(listOf(1_000.0, 12.0, 1_100.0, 40.0, 1_200.0, 14.0), series["rangeCm"]!!.points.toList())
        assertEquals(0.0, series["rangeCm"]!!.min, 0.0)
        assertEquals(40.0, series["rangeCm"]!!.max, 0.0)
    }

    @Test
    fun `charts nothing that is not a distance`() {
        val log = SensorLog()
        log.append("""{"tempC":40,"heapKb":200,"seq":1}""", 1_000L)
        log.append("""{"tempC":41,"heapKb":200,"seq":2}""", 1_100L)
        assertTrue(log.series().isEmpty())
    }

    @Test
    fun `drops frames older than the window`() {
        val log = SensorLog(historyMs = 1_000L)
        log.append("""{"distanceMm":100}""", 1_000L)
        log.append("""{"distanceMm":110}""", 1_500L)
        log.append("""{"distanceMm":120}""", 3_000L)
        log.append("""{"distanceMm":130}""", 3_100L)
        // The 1000 and 1500 frames fell out of the window; only the last two are left to draw.
        assertEquals(listOf(3_000.0, 12.0, 3_100.0, 13.0), log.series().first().points.toList())
    }

    @Test
    fun `forgets everything with the link`() {
        val log = SensorLog()
        log.append("""{"distanceMm":100}""", 1_000L)
        log.clear()
        assertTrue(log.keys().isEmpty())
        assertEquals(0, log.live().size)
        assertNull(log.rate().hz)
    }
}
