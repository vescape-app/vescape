package expo.modules.vescapecore.service

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CoreForegroundServiceLauncherTest {
    @Test
    fun `presence scan without scan permission skips service start`() {
        assertEquals(
            ForegroundServiceLaunchSkipReason.ScanPermissionMissing,
            foregroundServiceLaunchSkipReason(
                ForegroundServiceLaunchPreflight(
                    action = ForegroundServiceStartAction.PresenceScan,
                    bluetoothScanGranted = false,
                ),
            ),
        )
    }

    @Test
    fun `connected-device action without bluetooth permission skips service start`() {
        assertEquals(
            ForegroundServiceLaunchSkipReason.BluetoothPermissionMissing,
            foregroundServiceLaunchSkipReason(
                ForegroundServiceLaunchPreflight(
                    action = ForegroundServiceStartAction.BoardSession,
                    bluetoothConnectGranted = false,
                ),
            ),
        )
    }

    @Test
    fun `gps action without location permission skips service start`() {
        assertEquals(
            ForegroundServiceLaunchSkipReason.LocationPermissionMissing,
            foregroundServiceLaunchSkipReason(
                ForegroundServiceLaunchPreflight(
                    action = ForegroundServiceStartAction.GpsMonitoring,
                    locationGranted = false,
                ),
            ),
        )
    }

    @Test
    fun `group ride observe does not require bluetooth or location permission`() {
        assertNull(
            foregroundServiceLaunchSkipReason(
                ForegroundServiceLaunchPreflight(
                    action = ForegroundServiceStartAction.GroupRideObserve,
                    bluetoothConnectGranted = false,
                    locationGranted = false,
                ),
            ),
        )
    }

    /**
     * Presence Scan eligibility (no Boards, no Board Link, Bluetooth off, Auto Connect off) belongs
     * to `PresenceScanPolicy`, so the launcher only preflights the permissions Android needs to
     * start the service at all.
     */
    @Test
    fun `presence scan with permissions can start`() {
        assertNull(
            foregroundServiceLaunchSkipReason(
                ForegroundServiceLaunchPreflight(action = ForegroundServiceStartAction.PresenceScan),
            ),
        )
    }
}
