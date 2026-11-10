package expo.modules.vescapecore

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RideHazardCuesTest {
    private val cues = RideHazardCues()

    private fun hazard(kind: RideHazardKind, startedAt: Long = 1_000L) =
        RideHazard(kind, 50.0, 19.0, startedAt, startedAt + 600_000L)

    /** A fix [metres] south of the hazards. */
    private fun at(metres: Double) = cues.fix(50.0 - metres / 111_195.0, 19.0)

    @Test
    fun `cues once when closing in within 30 m, never on arrival`() {
        cues.roster(mapOf("ola" to hazard(RideHazardKind.MUD)))

        assertNull(at(50.0))
        assertNull(at(35.0))
        assertEquals("groupRide.hazard.mud", at(28.0))
        assertNull(at(20.0))
        assertNull(at(5.0))
    }

    @Test
    fun `a first fix inside the radius or jitter in place stays silent`() {
        cues.roster(mapOf("ola" to hazard(RideHazardKind.WATER)))

        assertNull(at(10.0))
        assertNull(at(9.0))
        assertNull(at(11.0))
        assertEquals("groupRide.hazard.water", at(6.0))
    }

    @Test
    fun `a replaced hazard is a new pin and cues again`() {
        cues.roster(mapOf("ola" to hazard(RideHazardKind.MUD)))
        at(40.0)
        assertEquals("groupRide.hazard.mud", at(25.0))

        cues.roster(mapOf("ola" to hazard(RideHazardKind.OBSTACLE, startedAt = 9_000L)))
        at(40.0)
        assertEquals("groupRide.hazard.obstacle", at(25.0))
    }

    @Test
    fun `the nearest of two approached hazards cues first, the other on the next fix`() {
        cues.roster(
            mapOf(
                "ola" to hazard(RideHazardKind.MUD),
                "kai" to RideHazard(RideHazardKind.DESCENT, 50.0 - 10.0 / 111_195.0, 19.0, 1_000L, 601_000L),
            ),
        )
        at(45.0)

        assertEquals("groupRide.hazard.descent", at(27.0))
        assertEquals("groupRide.hazard.mud", at(24.0))
    }

    @Test
    fun `reset forgets every hazard`() {
        cues.roster(mapOf("ola" to hazard(RideHazardKind.MUD)))
        at(40.0)
        cues.reset()

        assertNull(at(25.0))
    }
}
