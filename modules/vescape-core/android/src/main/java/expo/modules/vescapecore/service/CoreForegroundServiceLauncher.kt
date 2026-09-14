package expo.modules.vescapecore.service

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log

internal enum class ForegroundServiceStartAction {
    BoardSession,
    CompanionDevice,
    AutoConnectSelectedBoard,
    AccessorySessions,
    GpsMonitoring,
    GroupRideObserve,
}

internal enum class ForegroundServiceLaunchSkipReason {
    AutoConnectDisabled,
    SelectedBoardMissing,
    BluetoothPermissionMissing,
    LocationPermissionMissing,
}

internal data class ForegroundServiceLaunchPreflight(
    val action: ForegroundServiceStartAction,
    val autoConnectEnabled: Boolean = true,
    val selectedBoardId: String? = null,
    val bluetoothConnectGranted: Boolean = true,
    val locationGranted: Boolean = true,
)

internal data class ForegroundServiceLaunchResult(
    val started: Boolean,
    val skipReason: ForegroundServiceLaunchSkipReason? = null,
    val failureMessage: String? = null,
) {
    fun errorCode(): String =
        when (skipReason) {
            ForegroundServiceLaunchSkipReason.BluetoothPermissionMissing -> "BLUETOOTH_PERMISSION"
            ForegroundServiceLaunchSkipReason.LocationPermissionMissing -> "LOCATION_PERMISSION"
            ForegroundServiceLaunchSkipReason.AutoConnectDisabled,
            ForegroundServiceLaunchSkipReason.SelectedBoardMissing,
            null -> "FOREGROUND_SERVICE_START"
        }

    fun errorMessage(prefix: String): String =
        failureMessage ?: "$prefix: ${skipReason?.message ?: "unknown start failure"}"

    fun logIfSkipped(prefix: String) {
        if (started) return
        Log.w(VESC_SESSION_TAG, errorMessage(prefix))
    }
}

private val ForegroundServiceLaunchSkipReason.message: String
    get() = when (this) {
        ForegroundServiceLaunchSkipReason.AutoConnectDisabled -> "auto-connect disabled"
        ForegroundServiceLaunchSkipReason.SelectedBoardMissing -> "selected board missing"
        ForegroundServiceLaunchSkipReason.BluetoothPermissionMissing -> "Bluetooth permission not granted"
        ForegroundServiceLaunchSkipReason.LocationPermissionMissing -> "location permission not granted"
    }

internal fun foregroundServiceLaunchSkipReason(
    preflight: ForegroundServiceLaunchPreflight,
): ForegroundServiceLaunchSkipReason? =
    when (preflight.action) {
        ForegroundServiceStartAction.BoardSession,
        ForegroundServiceStartAction.CompanionDevice -> {
            if (!preflight.bluetoothConnectGranted) {
                ForegroundServiceLaunchSkipReason.BluetoothPermissionMissing
            } else {
                null
            }
        }
        ForegroundServiceStartAction.AutoConnectSelectedBoard -> {
            when {
                !preflight.autoConnectEnabled -> ForegroundServiceLaunchSkipReason.AutoConnectDisabled
                preflight.selectedBoardId.isNullOrBlank() -> ForegroundServiceLaunchSkipReason.SelectedBoardMissing
                !preflight.bluetoothConnectGranted -> ForegroundServiceLaunchSkipReason.BluetoothPermissionMissing
                else -> null
            }
        }
        ForegroundServiceStartAction.AccessorySessions -> {
            if (!preflight.bluetoothConnectGranted) {
                ForegroundServiceLaunchSkipReason.BluetoothPermissionMissing
            } else {
                null
            }
        }
        ForegroundServiceStartAction.GpsMonitoring -> {
            if (!preflight.locationGranted) {
                ForegroundServiceLaunchSkipReason.LocationPermissionMissing
            } else {
                null
            }
        }
        ForegroundServiceStartAction.GroupRideObserve -> null
    }

internal object CoreForegroundServiceLauncher {
    fun startBoardSession(context: Context, beforeStart: () -> Unit): ForegroundServiceLaunchResult =
        startConnectedDevice(
            context = context,
            action = ForegroundServiceStartAction.BoardSession,
            intentAction = ACTION_START_SESSION,
            failurePrefix = "Board session service start",
            beforeStart = beforeStart,
        )

    fun onCompanionDeviceAppeared(context: Context, address: String): ForegroundServiceLaunchResult =
        startConnectedDevice(
            context = context,
            action = ForegroundServiceStartAction.CompanionDevice,
            intentAction = ACTION_COMPANION_DEVICE_APPEARED,
            failurePrefix = "Companion service start",
            beforeStart = {},
        ) {
            putExtra(EXTRA_COMPANION_ADDRESS, address)
        }

    fun autoConnectSelectedBoard(
        context: Context,
        autoConnectEnabled: Boolean,
        selectedBoardId: String?,
    ): ForegroundServiceLaunchResult {
        val skipReason = foregroundServiceLaunchSkipReason(
            ForegroundServiceLaunchPreflight(
                action = ForegroundServiceStartAction.AutoConnectSelectedBoard,
                autoConnectEnabled = autoConnectEnabled,
                selectedBoardId = selectedBoardId,
                bluetoothConnectGranted = hasBluetoothConnectPermission(context),
            ),
        )
        if (skipReason != null) return ForegroundServiceLaunchResult(started = false, skipReason = skipReason)
        return startForegroundService(
            context = context,
            intentAction = ACTION_AUTO_CONNECT_SELECTED_BOARD,
            failurePrefix = "Auto-connect service start",
            beforeStart = {},
        )
    }

    /**
     * Brings the host up for enrolled Accessories, independently of any Board.
     *
     * An Accessory session is not a Board session: it must come up with no Board selected and with
     * Board auto-connect switched off, because the rider enrolled the Accessory rather than the
     * Board it happens to ride with.
     */
    fun autoConnectAccessories(context: Context): ForegroundServiceLaunchResult {
        val skipReason = foregroundServiceLaunchSkipReason(
            ForegroundServiceLaunchPreflight(
                action = ForegroundServiceStartAction.AccessorySessions,
                bluetoothConnectGranted = hasBluetoothConnectPermission(context),
            ),
        )
        if (skipReason != null) return ForegroundServiceLaunchResult(started = false, skipReason = skipReason)
        return startForegroundService(
            context = context,
            intentAction = ACTION_AUTO_CONNECT_ACCESSORIES,
            failurePrefix = "Accessory session service start",
            beforeStart = {},
        )
    }

    fun startGpsMonitoring(context: Context, beforeStart: () -> Unit): ForegroundServiceLaunchResult {
        val skipReason = foregroundServiceLaunchSkipReason(
            ForegroundServiceLaunchPreflight(
                action = ForegroundServiceStartAction.GpsMonitoring,
                locationGranted = hasLocationPermission(context),
            ),
        )
        if (skipReason != null) return ForegroundServiceLaunchResult(started = false, skipReason = skipReason)
        return startForegroundService(
            context = context,
            intentAction = ACTION_START_GPS_MONITORING,
            failurePrefix = "GPS service start",
            beforeStart = beforeStart,
        )
    }

    fun startGroupRideObserve(context: Context, beforeStart: () -> Unit): ForegroundServiceLaunchResult {
        val intent = Intent(context, CoreForegroundService::class.java).apply {
            action = ACTION_START_GROUP_RIDE_OBSERVE
        }
        beforeStart()
        return try {
            context.startService(intent)
            ForegroundServiceLaunchResult(started = true)
        } catch (e: Exception) {
            ForegroundServiceLaunchResult(started = false, failureMessage = "Group Ride observe service start failed: ${e.message}")
        }
    }

    private fun startConnectedDevice(
        context: Context,
        action: ForegroundServiceStartAction,
        intentAction: String,
        failurePrefix: String,
        beforeStart: () -> Unit,
        configure: Intent.() -> Unit = {},
    ): ForegroundServiceLaunchResult {
        val skipReason = foregroundServiceLaunchSkipReason(
            ForegroundServiceLaunchPreflight(
                action = action,
                bluetoothConnectGranted = hasBluetoothConnectPermission(context),
            ),
        )
        if (skipReason != null) return ForegroundServiceLaunchResult(started = false, skipReason = skipReason)
        return startForegroundService(context, intentAction, failurePrefix, beforeStart, configure)
    }

    private fun startForegroundService(
        context: Context,
        intentAction: String,
        failurePrefix: String,
        beforeStart: () -> Unit,
        configure: Intent.() -> Unit = {},
    ): ForegroundServiceLaunchResult {
        val intent = Intent(context, CoreForegroundService::class.java).apply {
            action = intentAction
            configure()
        }
        beforeStart()
        return try {
            context.startForegroundService(intent)
            ForegroundServiceLaunchResult(started = true)
        } catch (e: Exception) {
            ForegroundServiceLaunchResult(started = false, failureMessage = "$failurePrefix failed: ${e.message}")
        }
    }

    private fun hasBluetoothConnectPermission(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

    private fun hasLocationPermission(context: Context): Boolean =
        context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
}
