package expo.modules.vescapecore.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** @parity /modules/vescape-core/ios/navigation/Polyline6Tests.swift */
class Polyline6Test {

    private fun assertPointsEqual(expected: List<Pair<Double, Double>>, actual: List<Pair<Double, Double>>) {
        assertEquals(expected.size, actual.size)
        expected.zip(actual).forEach { (want, got) ->
            assertEquals(want.first, got.first, TOLERANCE)
            assertEquals(want.second, got.second, TOLERANCE)
        }
    }

    @Test
    fun `decodes the canonical two-point fixture at 1e6 precision`() {
        // Same coordinate pair as the classic polyline5 example, encoded at polyline6 precision.
        assertPointsEqual(
            listOf(38.5 to -120.2, 40.7 to -120.95),
            Polyline6.decode("_izlhA~rlgdF_{geC~ywl@"),
        )
    }

    @Test
    fun `decodes a multi-point path with mixed-sign deltas`() {
        assertPointsEqual(
            listOf(
                52.237049 to 21.017532,
                52.237712 to 21.018904,
                52.238500 to 21.016011,
            ),
            Polyline6.decode("qnhsbBwzxag@mh@wtAgp@xsD"),
        )
    }

    @Test
    fun `decoding at 1e6 does not produce the ten-times-larger 1e5 reading`() {
        // The precision trap: a 1e5 decoder would read the first point as 385.0 / -1202.0.
        val first = Polyline6.decode("_izlhA~rlgdF_{geC~ywl@").first()
        assertTrue(first.first in -90.0..90.0)
        assertTrue(first.second in -180.0..180.0)
    }

    @Test
    fun `empty input decodes to no points`() {
        assertEquals(emptyList<Pair<Double, Double>>(), Polyline6.decode(""))
    }

    @Test
    fun `a body truncated mid-value keeps the well-formed prefix`() {
        val full = "qnhsbBwzxag@mh@wtAgp@xsD"
        // Drops the final longitude delta, leaving a dangling latitude for the third point.
        val truncated = full.dropLast(4)

        assertPointsEqual(Polyline6.decode(full).take(2), Polyline6.decode(truncated))
    }

    @Test
    fun `encoding reproduces the body a path was decoded from`() {
        // Byte-identical, not merely equivalent: storage size depends on the encoder emitting the
        // same minimal varints Mapbox does.
        val body = "qnhsbBwzxag@mh@wtAgp@xsD"

        assertEquals(body, Polyline6.encode(Polyline6.decode(body)))
    }

    @Test
    fun `a path round-trips through encoding unchanged`() {
        val points = listOf(
            52.237049 to 21.017532,
            52.237712 to 21.018904,
            52.238500 to 21.016011,
            -33.868820 to 151.209290,
        )

        assertPointsEqual(points, Polyline6.decode(Polyline6.encode(points)))
    }

    @Test
    fun `no points encode to an empty body`() {
        assertEquals("", Polyline6.encode(emptyList()))
    }

    private companion object {
        const val TOLERANCE = 1e-6
    }
}
