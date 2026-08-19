package expo.modules.vescapecore.service

import android.content.pm.ServiceInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ForegroundServiceTypesTest {
    @Test
    fun `idle service has no foreground type`() {
        assertEquals(0, foregroundServiceType(emptySet()))
    }

    @Test
    fun `board session uses connected device type`() {
        assertEquals(
            ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE,
            foregroundServiceType(setOf(ForegroundWork.BoardSession)),
        )
    }

    @Test
    fun `presence scan uses connected device type`() {
        assertEquals(
            ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE,
            foregroundServiceType(setOf(ForegroundWork.PresenceScan)),
        )
    }

    @Test
    fun `gps adds location type to board session`() {
        assertEquals(
            ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE or
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
            foregroundServiceType(setOf(ForegroundWork.BoardSession, ForegroundWork.Gps)),
        )
    }

    @Test
    fun `gps alone uses location type`() {
        assertEquals(
            ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
            foregroundServiceType(setOf(ForegroundWork.Gps)),
        )
    }

    @Test
    fun `connected device type is asserted on top of active gps location type`() {
        assertEquals(
            ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE or
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
            foregroundServiceTypeWithConnectedDevice(setOf(ForegroundWork.Gps)),
        )
    }

    @Test
    fun `connected device type without owners is connected device only`() {
        assertEquals(
            ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE,
            foregroundServiceTypeWithConnectedDevice(emptySet()),
        )
    }
}

class ForegroundWorkOwnershipTest {
    private val ownership = ForegroundWorkOwnership()

    @Test
    fun `presence scan alone starts the searching presentation`() {
        val change = ownership.reconcile(ForegroundWork.PresenceScan to true)

        assertEquals(setOf(ForegroundWork.PresenceScan), change.acquired)
        assertEquals(ForegroundPresentation.Searching, change.presentation)
        assertTrue(change.hasWork)
    }

    @Test
    fun `releasing the presence scan with no other owner stops everything`() {
        ownership.reconcile(ForegroundWork.PresenceScan to true)

        val change = ownership.reconcile(ForegroundWork.PresenceScan to false)

        assertEquals(setOf(ForegroundWork.PresenceScan), change.released)
        assertEquals(ForegroundPresentation.Stopped, change.presentation)
        assertFalse(change.hasWork)
    }

    @Test
    fun `releasing the presence scan retains the service while gps monitors`() {
        ownership.reconcile(ForegroundWork.PresenceScan to true, ForegroundWork.Gps to true)

        val change = ownership.reconcile(ForegroundWork.PresenceScan to false, ForegroundWork.Gps to true)

        assertEquals(setOf(ForegroundWork.Gps), change.owners)
        assertEquals(ForegroundPresentation.Session, change.presentation)
        assertEquals(ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION, change.serviceType)
        assertTrue(change.hasWork)
    }

    @Test
    fun `releasing the presence scan retains the service while a group ride runs`() {
        ownership.reconcile(ForegroundWork.PresenceScan to true, ForegroundWork.GroupRide to true)

        val change = ownership.reconcile(
            ForegroundWork.PresenceScan to false,
            ForegroundWork.GroupRide to true,
        )

        assertEquals(setOf(ForegroundWork.GroupRide), change.owners)
        assertEquals(ForegroundPresentation.Session, change.presentation)
        assertTrue(change.hasWork)
    }

    @Test
    fun `a matched presence scan hands the same service to board session work`() {
        ownership.reconcile(ForegroundWork.PresenceScan to true)

        val change = ownership.reconcile(
            ForegroundWork.PresenceScan to false,
            ForegroundWork.BoardSession to true,
        )

        assertEquals(setOf(ForegroundWork.BoardSession), change.owners)
        assertEquals(setOf(ForegroundWork.BoardSession), change.acquired)
        assertEquals(setOf(ForegroundWork.PresenceScan), change.released)
        // The service never lost its last owner, so nothing could have stopped it in between.
        assertTrue(change.hasWork)
        assertEquals(ForegroundPresentation.Session, change.presentation)
    }

    @Test
    fun `reconciling unchanged state reports no acquisitions or releases`() {
        ownership.reconcile(ForegroundWork.BoardSession to true)

        val change = ownership.reconcile(ForegroundWork.BoardSession to true)

        assertTrue(change.acquired.isEmpty())
        assertTrue(change.released.isEmpty())
        assertTrue(ownership.holds(ForegroundWork.BoardSession))
    }

    @Test
    fun `a stale release of work already gone does not disturb newer owners`() {
        ownership.reconcile(ForegroundWork.PresenceScan to true)
        ownership.reconcile(ForegroundWork.PresenceScan to false, ForegroundWork.BoardSession to true)

        // A late callback from the finished scan reconciles only its own owner.
        val change = ownership.reconcile(ForegroundWork.PresenceScan to false)

        assertTrue(change.released.isEmpty())
        assertEquals(setOf(ForegroundWork.BoardSession), change.owners)
        assertTrue(ownership.holds(ForegroundWork.BoardSession))
    }
}
