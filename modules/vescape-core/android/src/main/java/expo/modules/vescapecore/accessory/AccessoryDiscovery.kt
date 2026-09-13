package expo.modules.vescapecore.accessory

import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import java.util.UUID

private const val TAG = "VescapeAccessory"

/**
 * Finding Accessories and asking each one what it is. Scanning matches the Vescape Accessory
 * service UUID, never a name: a name is a label the rider can change and other hardware can copy,
 * so it identifies nothing. The service is what makes a device an Accessory.
 *
 * Discovery is read-only by construction. It hands each device to a short-lived
 * [AccessoryGattHandshake] that writes one `hello`, reads the manifest, and disconnects; nothing on
 * this path can command an Accessory, and finding one never enrolls it. Enrollment is an explicit
 * rider action in a later slice.
 *
 * One inspection runs at a time. Two concurrent GATT handshakes against the same radio mostly
 * produce two timeouts, and the rider is looking at one row anyway.
 *
 * @parity /modules/vescape-core/ios/accessory/AccessoryDiscovery.swift
 */
@SuppressLint("MissingPermission")
object AccessoryDiscovery {
    /** Set by the Expo module so discovery can push devices without holding a module reference. */
    var emit: ((String, Map<String, Any?>) -> Unit)? = null

    private val handler = Handler(Looper.getMainLooper())
    private var scanCallback: ScanCallback? = null
    private var scanContext: Context? = null
    private var inFlight: AccessoryGattHandshake? = null

    fun startScan(context: Context) {
        stopScan()
        val app = context.applicationContext
        val scanner = (app.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)
            ?.adapter
            ?.bluetoothLeScanner
        if (scanner == null) {
            emit?.invoke("onAccessoryScanError", mapOf("error" to "bluetooth-unavailable"))
            return
        }
        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                emit?.invoke(
                    "onAccessoryDevice",
                    mapOf(
                        "id" to result.device.address,
                        // Nullable on purpose: a device that advertises no name is still a valid
                        // Accessory, and the manifest is where its real name comes from anyway.
                        "name" to (result.scanRecord?.deviceName ?: result.device.name),
                        "rssi" to result.rssi,
                    ),
                )
            }

            override fun onBatchScanResults(results: MutableList<ScanResult>) {
                results.forEach { onScanResult(ScanSettings.CALLBACK_TYPE_ALL_MATCHES, it) }
            }

            override fun onScanFailed(errorCode: Int) {
                scanCallback = null
                emit?.invoke("onAccessoryScanError", mapOf("error" to "scan-failed"))
            }
        }
        scanCallback = callback
        scanContext = app
        scanner.startScan(
            listOf(
                ScanFilter.Builder()
                    .setServiceUuid(ParcelUuid(AccessoryProtocol.SERVICE_UUID))
                    .build(),
            ),
            ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(),
            callback,
        )
    }

    fun stopScan() {
        val callback = scanCallback ?: return
        val app = scanContext
        scanCallback = null
        scanContext = null
        try {
            (app?.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)
                ?.adapter
                ?.bluetoothLeScanner
                ?.stopScan(callback)
        } catch (e: Exception) {
            Log.w(TAG, "scan stop failed: ${e.message}")
        }
    }

    /**
     * Connects to one discovered device and reads its manifest. [onResult] receives the bridge
     * payload exactly once, whether the handshake succeeded, was rejected, or timed out.
     */
    fun inspect(context: Context, deviceId: String, onResult: (Map<String, Any?>) -> Unit) {
        handler.post {
            if (inFlight != null) {
                onResult(payload(deviceId, null, null, "busy"))
                return@post
            }
            // Scanning while a handshake runs slows the connection down for no benefit: the rider
            // has already picked a row.
            stopScan()
            val sessionId = UUID.randomUUID().toString()
            val handshake = AccessoryGattHandshake(
                context.applicationContext,
                handler,
                deviceId,
                sessionId,
            ) { outcome ->
                inFlight = null
                onResult(
                    when (outcome) {
                        is AccessoryHandshakeOutcome.Ok ->
                            payload(deviceId, outcome.advertisedName, outcome.manifest, null)
                        is AccessoryHandshakeOutcome.Failed ->
                            payload(deviceId, outcome.advertisedName, null, outcome.error)
                    },
                )
            }
            inFlight = handshake
            handshake.start()
        }
    }

    /** Abandons an inspection the rider walked away from. */
    fun cancelInspection() {
        handler.post { inFlight?.cancel() }
    }

    private fun payload(
        deviceId: String,
        advertisedName: String?,
        manifest: AccessoryManifest?,
        error: String?,
    ): Map<String, Any?> = mapOf(
        "deviceId" to deviceId,
        "advertisedName" to advertisedName,
        "manifest" to manifest?.toMap(),
        "error" to error,
    )
}
