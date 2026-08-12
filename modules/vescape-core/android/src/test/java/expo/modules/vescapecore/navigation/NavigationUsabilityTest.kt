package expo.modules.vescapecore.navigation

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The forest case: Directions answers `200 OK` with a road detour to a target nothing can reach.
 *
 * @parity /modules/vescape-core/ios/navigation/NavigationUsabilityTests.swift
 */
class NavigationUsabilityTest {

    @Test
    fun `a path roughly as long as the straight line is usable`() {
        val points = listOf(RIDER_LAT to RIDER_LNG, 52.25 to 21.05, TARGET_LAT to TARGET_LNG)

        assertTrue(NavigationUsability.isUsable(points, TARGET_LAT, TARGET_LNG))
    }

    @Test
    fun `a path many times the straight line is rejected`() {
        val points = listOf(RIDER_LAT to RIDER_LNG, RIDER_LAT + 0.5 to RIDER_LNG, TARGET_LAT to TARGET_LNG)

        assertFalse(NavigationUsability.isUsable(points, TARGET_LAT, TARGET_LNG))
    }

    @Test
    fun `a single point is not a path`() {
        assertFalse(NavigationUsability.isUsable(listOf(RIDER_LAT to RIDER_LNG), TARGET_LAT, TARGET_LNG))
        assertFalse(NavigationUsability.isUsable(emptyList(), TARGET_LAT, TARGET_LNG))
    }

    @Test
    fun `the ratio is not applied to targets a few steps away`() {
        // ~11 m apart, where rounding one building is already a 10x "detour" and means nothing.
        val nearby = RIDER_LAT + 0.0001
        val points = listOf(
            RIDER_LAT to RIDER_LNG,
            RIDER_LAT to RIDER_LNG + 0.0008,
            nearby to RIDER_LNG,
        )

        assertTrue(NavigationUsability.isUsable(points, nearby, RIDER_LNG))
    }

    private companion object {
        const val RIDER_LAT = 52.2
        const val RIDER_LNG = 21.0
        const val TARGET_LAT = 52.3
        const val TARGET_LNG = 21.1
    }
}
