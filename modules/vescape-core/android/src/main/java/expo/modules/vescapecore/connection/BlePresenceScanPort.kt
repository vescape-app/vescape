package expo.modules.vescapecore.connection

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.os.Build
import android.util.Log
import expo.modules.vescapecore.service.VESC_SESSION_TAG

/**
 * Real Bluetooth behind [PresenceScanPort]. Readiness is reported the moment `startScan` is accepted
 * by the adapter, which is what makes the five-second Presence Scan window start on a usable radio
 * rather than at foreground entry.
 *
 * @parity /modules/vescape-core/ios/connection/BlePresenceScanPort.swift
 */
@SuppressLint("MissingPermission")
internal class BlePresenceScanPort(private val context: Context) : PresenceScanPort {
    private var callback: ScanCallback? = null

    private val adapter
        get() = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    override fun bluetoothEnabled(): Boolean = adapter?.isEnabled == true

    override fun scanPermissionGranted(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
        } else {
            context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        }

    override fun scannerAvailable(): Boolean = adapter?.bluetoothLeScanner != null

    override fun startScan(
        onReady: () -> Unit,
        onObserved: (bleId: String, rssi: Int?) -> Unit,
        onFailed: (message: String) -> Unit,
    ): Boolean {
        val scanner = adapter?.bluetoothLeScanner ?: return false
        val cb = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                onObserved(result.device.address, result.rssi)
            }

            override fun onScanFailed(errorCode: Int) {
                onFailed("BLE scan failed: $errorCode")
            }
        }
        return try {
            scanner.startScan(
                null,
                ScanSettings.Builder()
                    .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                    .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
                    .build(),
                cb,
            )
            callback = cb
            onReady()
            true
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Presence scan start failed: ${e.message}")
            false
        }
    }

    override fun stopScan() {
        val cb = callback ?: return
        callback = null
        try {
            adapter?.bluetoothLeScanner?.stopScan(cb)
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Presence scan stop failed: ${e.message}")
        }
    }
}
