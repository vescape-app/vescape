package expo.modules.vescapecore.service

import expo.modules.vescapecore.connection.BoardPhase

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.Activity.RESULT_OK
import android.bluetooth.le.ScanFilter
import android.companion.AssociationRequest
import android.companion.BluetoothLeDeviceFilter
import android.companion.CompanionDeviceManager
import android.content.Context
import android.content.IntentSender
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.vescapecore.telemetry.AppDataRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

internal const val COMPANION_ASSOCIATION_REQUEST_CODE = 7284

internal class CompanionPresence(
    private val context: Context,
    private val activityProvider: () -> Activity?,
    private val mainHandler: Handler = Handler(Looper.getMainLooper()),
) {
    private var pending: PendingAssociation? = null

    fun setEnabled(enabled: Boolean, promise: Promise) {
        if (enabled) enable(promise) else disable(promise)
    }

    fun addBoard(boardId: String, promise: Promise) {
        enableBoard(boardId, promise)
    }

    fun removeBoard(boardId: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            val repo = AppDataRepository.get(context)
            val bleId = boardBleId(repo, boardId)
            if (bleId == null) {
                promise.reject("COMPANION_BOARD_UNLINKED", "Board must have a BLE link", null)
                return@launch
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val manager = companionManager()
                try {
                    @Suppress("DEPRECATION")
                    manager.stopObservingDevicePresence(bleId)
                } catch (e: Exception) {
                    Log.w(VESC_SESSION_TAG, "Companion presence stop failed: ${e.message}")
                }
                try {
                    @Suppress("DEPRECATION")
                    manager.disassociate(bleId)
                } catch (e: Exception) {
                    Log.w(VESC_SESSION_TAG, "Companion disassociation failed: ${e.message}")
                }
            }
            promise.resolve(null)
        }
    }

    suspend fun getBoards(): List<Map<String, String>> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return emptyList()
        if (!AppDataRepository.get(context).getTypedSettings().companionPresenceEnabled) {
            return emptyList()
        }
        val associated = associatedAddresses(companionManager())
        return AppDataRepository.get(context).getBoards().mapNotNull { board ->
            val link = board["link"] as? Map<*, *> ?: return@mapNotNull null
            val bleId = link["bleId"] as? String ?: return@mapNotNull null
            if (associated.none { it.equals(bleId, ignoreCase = true) }) return@mapNotNull null
            mapOf(
                "boardId" to (board["id"] as String),
                "name" to (board["name"] as String),
                "bleId" to bleId,
            )
        }
    }

    fun onActivityResult(requestCode: Int, resultCode: Int) {
        if (requestCode != COMPANION_ASSOCIATION_REQUEST_CODE) return
        val current = pending ?: return
        pending = null
        if (resultCode != RESULT_OK) {
            current.promise.reject("COMPANION_ASSOCIATION_CANCELLED", "Companion device association cancelled", null)
            return
        }
        persistEnabledAndObserve(current.bleId, current.promise)
    }

    fun refreshForSelectedBoard() {
        CoroutineScope(Dispatchers.IO).launch {
            val repo = AppDataRepository.get(context)
            if (!repo.getTypedSettings().companionPresenceEnabled) return@launch
            for (board in getBoards()) {
                try {
                    observe(board.getValue("bleId"))
                } catch (e: Exception) {
                    Log.w(VESC_SESSION_TAG, "Companion presence refresh failed: ${e.message}")
                }
            }
        }
    }

    private fun enable(promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            promise.reject("COMPANION_PRESENCE_UNSUPPORTED", "Companion presence requires Android 12+", null)
            return
        }
        if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_COMPANION_DEVICE_SETUP)) {
            promise.reject("COMPANION_PRESENCE_UNSUPPORTED", "Companion device setup is unavailable", null)
            return
        }
        if (!hasObservePermission()) {
            promise.reject(
                "COMPANION_PRESENCE_PERMISSION_MISSING",
                "Companion presence permission is missing from the Android manifest",
                null,
            )
            return
        }

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val repo = AppDataRepository.get(context)
                repo.updateSetting("autoConnect", true)
                repo.updateSetting("companionPresenceEnabled", true)
                for (board in getBoards()) {
                    observe(board.getValue("bleId"))
                }
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("COMPANION_OBSERVE_FAILED", e.message, e)
            }
        }
    }

    private fun enableBoard(boardId: String, promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            promise.reject("COMPANION_PRESENCE_UNSUPPORTED", "Companion presence requires Android 12+", null)
            return
        }
        if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_COMPANION_DEVICE_SETUP)) {
            promise.reject("COMPANION_PRESENCE_UNSUPPORTED", "Companion device setup is unavailable", null)
            return
        }
        if (!hasObservePermission()) {
            promise.reject(
                "COMPANION_PRESENCE_PERMISSION_MISSING",
                "Companion presence permission is missing from the Android manifest",
                null,
            )
            return
        }
        CoroutineScope(Dispatchers.IO).launch {
            val repo = AppDataRepository.get(context)
            val bleId = boardBleId(repo, boardId)
            if (bleId == null) {
                promise.reject("COMPANION_BOARD_UNLINKED", "Selected board must have a BLE link", null)
                return@launch
            }
            // Auto-start claims the board exclusively. Rather than ask the user to disconnect first,
            // drop the live session ourselves and continue once it's down.
            if (isSelectedBoardConnected(bleId)) {
                CoreForegroundService.stopBoardSession(context.applicationContext) {
                    mainHandler.post { associateOrObserveSafely(bleId, promise) }
                }
                return@launch
            }
            mainHandler.post { associateOrObserveSafely(bleId, promise) }
        }
    }

    private fun disable(promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            val repo = AppDataRepository.get(context)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                for (board in getBoards()) {
                    try {
                        @Suppress("DEPRECATION")
                        companionManager().stopObservingDevicePresence(board.getValue("bleId"))
                    } catch (e: Exception) {
                        Log.w(VESC_SESSION_TAG, "Companion presence stop failed: ${e.message}")
                    }
                }
            }
            repo.updateSetting("companionPresenceEnabled", false)
            promise.resolve(null)
        }
    }

    private fun associateOrObserveSafely(bleId: String, promise: Promise) {
        try {
            associateOrObserve(bleId, promise)
        } catch (e: Exception) {
            promise.reject("COMPANION_ASSOCIATION_FAILED", e.message, e)
        }
    }

    @SuppressLint("MissingPermission")
    private fun associateOrObserve(bleId: String, promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        val manager = companionManager()
        if (isAssociated(manager, bleId)) {
            persistEnabledAndObserve(bleId, promise)
            return
        }
        val activity = activityProvider()
        if (activity == null) {
            promise.reject("COMPANION_ACTIVITY_MISSING", "Open settings before enabling companion presence", null)
            return
        }
        val request = AssociationRequest.Builder()
            .addDeviceFilter(
                BluetoothLeDeviceFilter.Builder()
                    .setScanFilter(ScanFilter.Builder().setDeviceAddress(bleId).build())
                    .build(),
            )
            .setSingleDevice(true)
            .build()

        pending = PendingAssociation(bleId, promise)
        @Suppress("DEPRECATION")
        manager.associate(
            request,
            object : CompanionDeviceManager.Callback() {
                override fun onDeviceFound(chooserLauncher: IntentSender) {
                    try {
                        activity.startIntentSenderForResult(
                            chooserLauncher,
                            COMPANION_ASSOCIATION_REQUEST_CODE,
                            null,
                            0,
                            0,
                            0,
                        )
                    } catch (e: Exception) {
                        pending = null
                        promise.reject("COMPANION_ASSOCIATION_FAILED", e.message, e)
                    }
                }

                override fun onFailure(error: CharSequence?) {
                    pending = null
                    // Android 14+ reports a dismissed chooser here ("user_rejected") instead of a
                    // cancelled activity result. Both mean "the rider backed out", not a failure.
                    val reason = error?.toString().orEmpty()
                    if (reason.contains("user_rejected", ignoreCase = true) ||
                        reason.contains("cancel", ignoreCase = true)
                    ) {
                        promise.reject(
                            "COMPANION_ASSOCIATION_CANCELLED",
                            "Companion device association cancelled",
                            null,
                        )
                        return
                    }
                    promise.reject(
                        "COMPANION_ASSOCIATION_FAILED",
                        reason.ifEmpty { "Companion association failed" },
                        null,
                    )
                }

                override fun onAssociationCreated(associationInfo: android.companion.AssociationInfo) {
                    pending = null
                    persistEnabledAndObserve(bleId, promise)
                }
            },
            mainHandler,
        )
    }

    private fun persistEnabledAndObserve(bleId: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                observe(bleId)
                val repo = AppDataRepository.get(context)
                repo.updateSetting("autoConnect", true)
                repo.updateSetting("companionPresenceEnabled", true)
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("COMPANION_OBSERVE_FAILED", e.message, e)
            }
        }
    }

    @SuppressLint("MissingPermission")
    private fun observe(bleId: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        @Suppress("DEPRECATION")
        companionManager().startObservingDevicePresence(bleId)
        Log.d(VESC_SESSION_TAG, "Companion presence observing $bleId")
    }

    @Suppress("DEPRECATION")
    private fun isAssociated(manager: CompanionDeviceManager, bleId: String): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return manager.myAssociations.any {
                it.deviceMacAddress?.toString()?.equals(bleId, ignoreCase = true) == true
            }
        }
        return manager.associations.any { it.equals(bleId, ignoreCase = true) }
    }

    private fun hasObservePermission(): Boolean =
        ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.REQUEST_OBSERVE_COMPANION_DEVICE_PRESENCE,
        ) == PackageManager.PERMISSION_GRANTED

    private fun companionManager(): CompanionDeviceManager =
        context.getSystemService(CompanionDeviceManager::class.java)

    private suspend fun boardBleId(repo: AppDataRepository, boardId: String): String? {
        val board = repo.getBoard(boardId) ?: return null
        val link = board["link"] as? Map<*, *> ?: return null
        return (link["bleId"] as? String)?.takeIf { it.isNotBlank() }
    }

    @Suppress("DEPRECATION")
    private fun associatedAddresses(manager: CompanionDeviceManager): Set<String> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            manager.myAssociations.mapNotNull { it.deviceMacAddress?.toString() }.toSet()
        } else {
            manager.associations.toSet()
        }

    private fun isSelectedBoardConnected(bleId: String): Boolean {
        val board = CoreForegroundService.currentLiveState(context)["board"] as? Map<*, *> ?: return false
        if (!(board["bleId"] as? String).equals(bleId, ignoreCase = true)) return false
        return board["phase"] in setOf(
            BoardPhase.Connecting.wireValue,
            BoardPhase.Discovering.wireValue,
            BoardPhase.Subscribing.wireValue,
            BoardPhase.WaitingForTelemetry.wireValue,
            BoardPhase.Connected.wireValue,
            BoardPhase.Stale.wireValue,
            BoardPhase.Reconnecting.wireValue,
            BoardPhase.Rescanning.wireValue,
        )
    }

    private data class PendingAssociation(val bleId: String, val promise: Promise)
}
