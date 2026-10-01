package app.vescape.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ReplayFixtureParserTest {
    @Test
    fun `seeded detours move smoothly off route then rejoin and trail follows actual positions`() {
        val lines = (0..240).map { i ->
            """{"t":${i * 500},"speed":21.6,"riderEast":0,"riderNorth":${i * 3},"course":0,"navBearing":0,"navDistance":2000}"""
        }
        val straight = ReplayFixtureParser.parse(lines.asSequence())
        val detour = ReplayFixtureParser.parse(lines.asSequence(), wander = true)
        assertEquals(detour, ReplayFixtureParser.parse(lines.asSequence(), wander = true))
        assertEquals(straight.first(), detour.first())
        assertEquals(0.0, detour.last().frame.riderEastM!!, 0.0001)
        assertEquals(720.0, detour.last().frame.riderNorthM!!, 0.0001)
        assertTrue(detour.any { kotlin.math.abs(it.frame.riderEastM!!) > 15 })
        assertTrue(detour.any { kotlin.math.abs(it.frame.courseDeg!!) > 5 })
        for (i in 1 until detour.size) {
            val frame = detour[i].frame
            val previous = detour[i - 1].frame
            assertTrue(kotlin.math.hypot(frame.riderEastM!! - previous.riderEastM!!, frame.riderNorthM!! - previous.riderNorthM!!) < 5)
            assertEquals(straight[i].frame.navBearing, frame.navBearing)
            assertEquals(-frame.riderEastM, frame.trail.first().eastM, 0.0001)
            assertEquals(-frame.riderNorthM, frame.trail.first().northM, 0.0001)
            assertEquals(0.0, frame.trail.last().eastM, 0.0001)
            assertEquals(0.0, frame.trail.last().northM, 0.0001)
        }
    }

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
        assertEquals(8.3, samples[0].frame.speed!!, 0.001)
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
    @Test fun `ride fixture keeps moving and showing its trail after navigation ends`() {
        val fixture = generateSequence(File(requireNotNull(System.getProperty("user.dir")))) { it.parentFile }
            .map { File(it, "watch/wearos/src/main/assets/watch-ride.jsonl") }.first { it.exists() }
        for (wander in listOf(false, true)) {
            val samples = fixture.useLines { ReplayFixtureParser.parse(it, wander = wander) }
            val arrival = samples.indexOfFirst { it.frame.navBearing == null }
            assertTrue(arrival > 0)
            val after = samples.drop(arrival)
            assertTrue(after.isNotEmpty())
            assertTrue(after.all { it.frame.mapPosition != null && it.frame.trail.size > 1 })
            assertTrue(after.first().frame.mapPosition != after.last().frame.mapPosition)
        }
    }

}
