package expo.modules.vescapecore.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONObject

/**
 * The stored form has to carry why there is no path, or a restart turns a rider's "no path here,
 * retry?" into a blank map with a pin on it.
 *
 * @parity /modules/vescape-core/ios/navigation/NavigationStoreTests.swift
 */
class NavigationJsonTest {

    @Test
    fun `a failed Navigation survives a round trip with no points`() {
        val failed = navigation(NavigationStatus.NO_PATH_FOUND, emptyList())

        val restored = NavigationJson.decode(NavigationJson.encode(failed))

        assertEquals(NavigationStatus.NO_PATH_FOUND, restored?.status)
        assertTrue(restored?.points.isNullOrEmpty())
    }

    @Test
    fun `a ready Navigation keeps its points`() {
        val ready = navigation(NavigationStatus.READY, listOf(52.2 to 21.0, 52.3 to 21.1))

        val restored = NavigationJson.decode(NavigationJson.encode(ready))

        assertEquals(NavigationStatus.READY, restored?.status)
        assertEquals(2, restored?.points?.size)
    }

    @Test
    fun `a row written before the status existed reads as ready`() {
        val legacy = JSONObject(
            NavigationJson.encode(navigation(NavigationStatus.READY, listOf(52.2 to 21.0, 52.3 to 21.1))),
        ).apply { remove("status") }.toString()

        assertEquals(NavigationStatus.READY, NavigationJson.decode(legacy)?.status)
    }

    @Test
    fun `a ready row with no points is a contradiction and is dropped`() {
        val impossible = NavigationJson.encode(navigation(NavigationStatus.READY, emptyList()))

        assertNull(NavigationJson.decode(impossible))
    }

    private fun navigation(status: NavigationStatus, points: List<Pair<Double, Double>>) = Navigation(
        targetLatitude = 52.3,
        targetLongitude = 21.1,
        profile = NavigationProfile.WALKING,
        computedAtMs = 1_700_000_000_000L,
        status = status,
        points = points,
    )
}
