package app.vescape.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReplayFixtureParserTest {
    @Test
    fun `reads lanes and recorded time`() {
        val samples = ReplayFixtureParser.parse(
            sequenceOf(
                """{"t":0,"speed":8.3,"duty":17,"battery":82.1,"motorTemp":33,"ctrlTemp":5}""",
                """{"t":500,"speed":9,"duty":18,"battery":84.2,"motorTemp":33,"ctrlTemp":5}""",
            ),
        )

        assertEquals(2, samples.size)
        assertEquals(0L, samples[0].atMs)
        assertEquals(8.3, samples[0].frame.speed, 0.001)
        assertEquals(17.0, samples[0].frame.duty!!, 0.001)
        assertEquals(500L, samples[1].atMs)
    }

    @Test
    fun `null lanes stay null so the gauges render them as unreported`() {
        val samples = ReplayFixtureParser.parse(
            sequenceOf("""{"t":0,"speed":12,"duty":null,"battery":null,"motorTemp":null,"ctrlTemp":null}"""),
        )

        assertNull(samples[0].frame.duty)
        assertNull(samples[0].frame.battery)
        assertNull(samples[0].frame.motorTemp)
        assertNull(samples[0].frame.ctrlTemp)
    }

    @Test
    fun `stale defaults to false and is honoured when set`() {
        val samples = ReplayFixtureParser.parse(
            sequenceOf(
                """{"t":0,"speed":12,"duty":1,"battery":1,"motorTemp":1,"ctrlTemp":1}""",
                """{"t":500,"speed":12,"duty":1,"battery":1,"motorTemp":1,"ctrlTemp":1,"stale":true}""",
            ),
        )

        assertEquals(false, samples[0].frame.stale)
        assertTrue(samples[1].frame.stale)
    }

    @Test
    fun `malformed and blank lines are skipped, not fatal`() {
        val samples = ReplayFixtureParser.parse(
            sequenceOf(
                "",
                "not json",
                """{"t":0,"duty":17}""", // no speed lane
                """{"t":1000,"speed":20,"duty":30,"battery":50,"motorTemp":40,"ctrlTemp":30}""",
            ),
        )

        assertEquals(1, samples.size)
        assertEquals(1000L, samples[0].atMs)
    }
}
