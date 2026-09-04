package app.vescape.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RainViewerTest {
    @Test
    fun `parses host and past frames`() {
        val meta = RainViewer.parseMeta(
            """
            {
              "host": "https://tilecache.rainviewer.com",
              "radar": {
                "past": [
                  { "time": 1757000000, "path": "/v2/radar/1757000000" },
                  { "time": 1757000600, "path": "/v2/radar/1757000600" }
                ],
                "nowcast": [ { "time": 1757001200, "path": "/v2/radar/nowcast_1" } ]
              }
            }
            """.trimIndent(),
        )

        assertEquals("https://tilecache.rainviewer.com", meta?.host)
        // Nowcast frames are a forecast, not an observation: the wrist animates past frames only.
        assertEquals(listOf(1757000000L, 1757000600L), meta?.frames?.map { it.timeSec })
    }

    @Test
    fun `a payload without radar frames is not a radar`() {
        assertNull(RainViewer.parseMeta("""{ "host": "https://example.test" }"""))
        assertNull(RainViewer.parseMeta("not json"))
    }

    @Test
    fun `frame range shrinks with latitude`() {
        // The same image is a smaller patch of ground the further north it is taken, so the range
        // rings must be placed per latitude rather than once.
        val warsaw = radarFaceRangeM(52.2297)
        val equator = radarFaceRangeM(0.0)

        assertEquals(313_086.0, equator, 1.0)
        assertEquals(191_635.0, warsaw, 1_000.0)
    }

    @Test
    fun `frame url centres the image on the rider`() {
        val frame = RadarFrame(timeSec = 1757000000, path = "/v2/radar/1757000000")

        assertEquals(
            "https://tilecache.rainviewer.com/v2/radar/1757000000/256/6/52.2297/21.0122/2/1_1.png",
            RainViewer.frameUrl("https://tilecache.rainviewer.com", frame, 52.2297, 21.0122),
        )
    }
}
