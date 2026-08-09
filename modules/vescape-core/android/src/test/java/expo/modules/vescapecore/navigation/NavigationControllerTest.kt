package expo.modules.vescapecore.navigation

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * The rider's last action must win. A Directions call takes seconds, so a fetch started for an
 * abandoned target routinely resolves after the rider has already moved or cleared the pin.
 *
 * @parity /modules/vescape-core/ios/navigation/NavigationControllerTests.swift
 */
class NavigationControllerTest {

    /** Routing stub whose calls finish only when the test says so. */
    private class GatedRoutes : DirectionsRoutes {
        private val gates = mutableMapOf<Double, CountDownLatch>()
        val started = CountDownLatch(1)
        val calls = AtomicInteger(0)

        fun gate(targetLatitude: Double): CountDownLatch =
            synchronized(gates) { gates.getOrPut(targetLatitude) { CountDownLatch(1) } }

        override suspend fun route(
            fromLatitude: Double,
            fromLongitude: Double,
            toLatitude: Double,
            toLongitude: Double,
            profile: String,
        ): DirectionsResult {
            calls.incrementAndGet()
            started.countDown()
            gate(toLatitude).await(WAIT_SECONDS, TimeUnit.SECONDS)
            return DirectionsResult.Path(listOf(fromLatitude to fromLongitude, toLatitude to toLongitude))
        }
    }

    /** Routing stub that answers immediately with whatever the test hands it. */
    private class FixedRoutes(private val result: DirectionsResult) : DirectionsRoutes {
        override suspend fun route(
            fromLatitude: Double,
            fromLongitude: Double,
            toLatitude: Double,
            toLongitude: Double,
            profile: String,
        ): DirectionsResult = result
    }

    /** In-memory stand-in for the App Settings rows, so restore and write-through need no database. */
    private class FakeStore(
        var stored: Navigation? = null,
        var directionPoint: Pair<Double, Double>? = null,
        var storedProfile: NavigationProfile? = null,
    ) : NavigationStore {
        private val lock = Any()

        override suspend fun load(): Navigation? = synchronized(lock) { stored }

        override suspend fun save(navigation: Navigation?) {
            synchronized(lock) { stored = navigation }
        }

        override suspend fun directionPoint(): Pair<Double, Double>? = synchronized(lock) { directionPoint }

        override suspend fun loadProfile(): NavigationProfile? = synchronized(lock) { storedProfile }

        override suspend fun saveProfile(profile: NavigationProfile) {
            synchronized(lock) { storedProfile = profile }
        }
    }

    /** Routing stub that records the profile it was asked for. */
    private class ProfileRecordingRoutes : DirectionsRoutes {
        private val seen = mutableListOf<String>()

        val profiles: List<String> get() = synchronized(seen) { seen.toList() }

        override suspend fun route(
            fromLatitude: Double,
            fromLongitude: Double,
            toLatitude: Double,
            toLongitude: Double,
            profile: String,
        ): DirectionsResult {
            synchronized(seen) { seen += profile }
            return DirectionsResult.Path(listOf(fromLatitude to fromLongitude, toLatitude to toLongitude))
        }
    }

    private fun controller(
        routes: DirectionsRoutes,
        store: NavigationStore = FakeStore(),
    ): Pair<NavigationController, MutableList<Navigation?>> {
        val controller =
            NavigationController(routes, store, CoroutineScope(SupervisorJob() + Dispatchers.IO))
        val emitted = mutableListOf<Navigation?>()
        controller.onChange = { synchronized(emitted) { emitted += it } }
        return controller to emitted
    }

    private fun navigation(targetLatitude: Double = TARGET_LAT) = Navigation(
        targetLatitude = targetLatitude,
        targetLongitude = TARGET_LNG,
        profile = NavigationProfile.WALKING,
        computedAtMs = 1_700_000_000_000L,
        status = NavigationStatus.READY,
        points = listOf(RIDER_LAT to RIDER_LNG, targetLatitude to TARGET_LNG),
    )

    @Test
    fun `a stored path comes back on restore without a Directions call`() {
        val routes = GatedRoutes()
        val store = FakeStore(navigation(), TARGET_LAT to TARGET_LNG)
        val (controller, emitted) = controller(routes, store)

        controller.restore()
        Thread.sleep(SETTLE_MS)

        assertEquals(TARGET_LAT, controller.current?.targetLatitude)
        assertEquals(navigation().points, controller.current?.points)
        // Restoring is a read: a path computed last weekend is still the path.
        assertEquals(0, routes.calls.get())
        synchronized(emitted) { assertEquals(1, emitted.size) }
    }

    @Test
    fun `a stored path whose target disagrees with the Direction Point is discarded`() {
        val store = FakeStore(navigation(), SECOND_TARGET_LAT to TARGET_LNG)
        val (controller, emitted) = controller(GatedRoutes(), store)

        controller.restore()
        Thread.sleep(SETTLE_MS)

        assertNull(controller.current)
        // Dropped from storage too, or every later start would re-read and re-reject it.
        assertNull(store.stored)
        synchronized(emitted) { assertTrue(emitted.isEmpty()) }
    }

    @Test
    fun `a rider tap during restore wins over the stored path`() {
        val routes = GatedRoutes()
        val store = FakeStore(navigation(), TARGET_LAT to TARGET_LNG)
        val (controller, _) = controller(routes, store)

        controller.restore()
        controller.setTarget(SECOND_TARGET_LAT, TARGET_LNG, RIDER_LAT, RIDER_LNG)
        routes.gate(SECOND_TARGET_LAT).countDown()
        Thread.sleep(SETTLE_MS)

        assertEquals(SECOND_TARGET_LAT, controller.current?.targetLatitude)
        assertEquals(SECOND_TARGET_LAT, store.stored?.targetLatitude)
    }

    @Test
    fun `clearing the Direction Point erases the stored path`() {
        val routes = GatedRoutes()
        val store = FakeStore()
        val (controller, _) = controller(routes, store)

        controller.setTarget(TARGET_LAT, TARGET_LNG, RIDER_LAT, RIDER_LNG)
        routes.gate(TARGET_LAT).countDown()
        Thread.sleep(SETTLE_MS)
        assertEquals(TARGET_LAT, store.stored?.targetLatitude)

        controller.clear()
        Thread.sleep(SETTLE_MS)

        assertNull(store.stored)
    }

    @Test
    fun `a fetch that resolves after a clear does not resurrect the path`() {
        val routes = GatedRoutes()
        val (controller, emitted) = controller(routes)

        controller.setTarget(TARGET_LAT, TARGET_LNG, RIDER_LAT, RIDER_LNG)
        assertTrue(routes.started.await(WAIT_SECONDS, TimeUnit.SECONDS))
        controller.clear()
        routes.gate(TARGET_LAT).countDown()
        Thread.sleep(SETTLE_MS)

        assertNull(controller.current)
        synchronized(emitted) { assertTrue(emitted.all { it == null }) }
    }

    @Test
    fun `a slow earlier fetch does not overwrite a newer target`() {
        val routes = GatedRoutes()
        val (controller, _) = controller(routes)

        controller.setTarget(TARGET_LAT, TARGET_LNG, RIDER_LAT, RIDER_LNG)
        assertTrue(routes.started.await(WAIT_SECONDS, TimeUnit.SECONDS))
        controller.setTarget(SECOND_TARGET_LAT, TARGET_LNG, RIDER_LAT, RIDER_LNG)
        // Newer target resolves first, then the abandoned one.
        routes.gate(SECOND_TARGET_LAT).countDown()
        Thread.sleep(SETTLE_MS)
        routes.gate(TARGET_LAT).countDown()
        Thread.sleep(SETTLE_MS)

        assertEquals(SECOND_TARGET_LAT, controller.current?.targetLatitude)
    }

    @Test
    fun `moving the Direction Point drops the old path before the new one arrives`() {
        val routes = GatedRoutes()
        val (controller, emitted) = controller(routes)

        controller.setTarget(TARGET_LAT, TARGET_LNG, RIDER_LAT, RIDER_LNG)
        routes.gate(TARGET_LAT).countDown()
        Thread.sleep(SETTLE_MS)
        assertEquals(TARGET_LAT, controller.current?.targetLatitude)

        controller.setTarget(SECOND_TARGET_LAT, TARGET_LNG, RIDER_LAT, RIDER_LNG)

        // A Navigation belongs to exactly one Direction Point: the old path must not stay drawn
        // under a pin that has already moved.
        assertNull(controller.current)
        synchronized(emitted) { assertNull(emitted.last()) }
    }

    @Test
    fun `no rider position is reported as a fetch failure, not as no Navigation`() {
        val routes = GatedRoutes()
        val (controller, _) = controller(routes)

        controller.setTarget(TARGET_LAT, TARGET_LNG, null, null)

        assertEquals(NavigationStatus.FETCH_FAILED, controller.current?.status)
        assertTrue(controller.current?.points.isNullOrEmpty())
        // Nothing to ask with, so nothing was asked.
        assertEquals(0, routes.calls.get())
    }

    @Test
    fun `a failed fetch and an empty answer are different failures`() {
        val (failing, _) = controller(FixedRoutes(DirectionsResult.Failed))
        failing.setTarget(TARGET_LAT, TARGET_LNG, RIDER_LAT, RIDER_LNG)
        Thread.sleep(SETTLE_MS)

        val (empty, _) = controller(FixedRoutes(DirectionsResult.NoPath))
        empty.setTarget(TARGET_LAT, TARGET_LNG, RIDER_LAT, RIDER_LNG)
        Thread.sleep(SETTLE_MS)

        assertEquals(NavigationStatus.FETCH_FAILED, failing.current?.status)
        assertEquals(NavigationStatus.NO_PATH_FOUND, empty.current?.status)
    }

    @Test
    fun `a path that detours absurdly around the target is no path at all`() {
        // Straight line is ~13 km; this answer rides ~110 km of it, the shape Directions returns
        // when the only way to the target is back out along a road.
        val detour = DirectionsResult.Path(
            listOf(RIDER_LAT to RIDER_LNG, RIDER_LAT + 0.5 to RIDER_LNG, TARGET_LAT to TARGET_LNG),
        )
        val (controller, _) = controller(FixedRoutes(detour))

        controller.setTarget(TARGET_LAT, TARGET_LNG, RIDER_LAT, RIDER_LNG)
        Thread.sleep(SETTLE_MS)

        assertEquals(NavigationStatus.NO_PATH_FOUND, controller.current?.status)
        assertTrue(controller.current?.points.isNullOrEmpty())
    }

    @Test
    fun `a failed Navigation is stored, so a restart does not hide the failure`() {
        val store = FakeStore(directionPoint = TARGET_LAT to TARGET_LNG)
        val (controller, _) = controller(FixedRoutes(DirectionsResult.Failed), store)

        controller.setTarget(TARGET_LAT, TARGET_LNG, RIDER_LAT, RIDER_LNG)
        Thread.sleep(SETTLE_MS)
        assertEquals(NavigationStatus.FETCH_FAILED, store.stored?.status)

        val (restarted, _) = controller(GatedRoutes(), store)
        restarted.restore()
        Thread.sleep(SETTLE_MS)

        assertEquals(NavigationStatus.FETCH_FAILED, restarted.current?.status)
    }

    @Test
    fun `retrying a failed Navigation recomputes it from the rider's current position`() {
        val routes = GatedRoutes()
        val store = FakeStore(directionPoint = TARGET_LAT to TARGET_LNG)
        val (controller, _) = controller(FixedRoutes(DirectionsResult.Failed), store)
        controller.setTarget(TARGET_LAT, TARGET_LNG, RIDER_LAT, RIDER_LNG)
        Thread.sleep(SETTLE_MS)

        // Retry is an ordinary `setTarget` from where the rider is now, which is what the module
        // calls. The rider has moved since the pin was dropped.
        val (retrying, _) = controller(routes, store)
        retrying.setTarget(TARGET_LAT, TARGET_LNG, RIDER_LAT + 0.01, RIDER_LNG)
        routes.gate(TARGET_LAT).countDown()
        Thread.sleep(SETTLE_MS)

        assertEquals(NavigationStatus.READY, retrying.current?.status)
        assertEquals(RIDER_LAT + 0.01, retrying.current?.points?.first()?.first ?: 0.0, 1e-9)
    }

    @Test
    fun `the sticky profile is what the next Navigation is computed under`() {
        val routes = ProfileRecordingRoutes()
        val store = FakeStore(storedProfile = NavigationProfile.CYCLING)
        val (controller, _) = controller(routes, store)

        controller.restore()
        Thread.sleep(SETTLE_MS)
        controller.setTarget(TARGET_LAT, TARGET_LNG, RIDER_LAT, RIDER_LNG)
        Thread.sleep(SETTLE_MS)

        assertEquals(listOf("cycling"), routes.profiles)
        assertEquals(NavigationProfile.CYCLING, controller.current?.profile)
    }

    @Test
    fun `a rider who has never chosen walks`() {
        val routes = ProfileRecordingRoutes()
        val (controller, _) = controller(routes, FakeStore())

        controller.restore()
        Thread.sleep(SETTLE_MS)
        controller.setTarget(TARGET_LAT, TARGET_LNG, RIDER_LAT, RIDER_LNG)
        Thread.sleep(SETTLE_MS)

        assertEquals(listOf("walking"), routes.profiles)
    }

    @Test
    fun `choosing a profile sticks it for the next Navigation`() {
        val routes = ProfileRecordingRoutes()
        val store = FakeStore()
        val (controller, _) = controller(routes, store)

        controller.selectProfile(NavigationProfile.DRIVING)
        controller.recompute(TARGET_LAT, TARGET_LNG, RIDER_LAT, RIDER_LNG)
        Thread.sleep(SETTLE_MS)

        assertEquals(NavigationProfile.DRIVING, store.storedProfile)
        assertEquals(NavigationProfile.DRIVING, controller.current?.profile)
        // The next Direction Point is computed under it without being told again.
        controller.setTarget(SECOND_TARGET_LAT, TARGET_LNG, RIDER_LAT, RIDER_LNG)
        Thread.sleep(SETTLE_MS)
        assertEquals(listOf("driving", "driving"), routes.profiles)
    }

    @Test
    fun `a recompute that finds nothing leaves the drawn path alone`() {
        val store = FakeStore(navigation(), TARGET_LAT to TARGET_LNG)
        val (controller, emitted) = controller(FixedRoutes(DirectionsResult.Failed), store)
        controller.restore()
        Thread.sleep(SETTLE_MS)
        val drawn = controller.current
        assertEquals(NavigationStatus.READY, drawn?.status)

        controller.recompute(TARGET_LAT, TARGET_LNG, RIDER_LAT, RIDER_LNG)
        Thread.sleep(SETTLE_MS)

        // Losing a working line by asking for a better one is a bad trade.
        assertEquals(drawn, controller.current)
        assertEquals(NavigationStatus.READY, store.stored?.status)
        synchronized(emitted) { assertEquals(NavigationStatus.READY, emitted.last()?.status) }
    }

    @Test
    fun `a recompute with nothing drawn yet reports the failure`() {
        val (controller, _) = controller(FixedRoutes(DirectionsResult.NoPath))

        controller.recompute(TARGET_LAT, TARGET_LNG, RIDER_LAT, RIDER_LNG)
        Thread.sleep(SETTLE_MS)

        assertEquals(NavigationStatus.NO_PATH_FOUND, controller.current?.status)
    }

    private companion object {
        const val RIDER_LAT = 52.2
        const val RIDER_LNG = 21.0
        const val TARGET_LAT = 52.3
        const val SECOND_TARGET_LAT = 52.4
        const val TARGET_LNG = 21.1
        const val WAIT_SECONDS = 5L
        const val SETTLE_MS = 250L
    }
}
