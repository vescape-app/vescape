package expo.modules.vescapecore.reconnect
import expo.modules.vescapecore.service.VESC_SESSION_TAG
import android.annotation.SuppressLint
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.util.Log
import expo.modules.vescapecore.runtime.Scheduler

@SuppressLint("MissingPermission")
internal class ReconnectBleScanner(
    private val scanner: () -> BluetoothLeScanner?,
    private val scheduler: Scheduler,
) : ReconnectBlePort {
    private var activeCallback: ScanCallback? = null

    override fun hasScanner(): Boolean = scanner() != null

    override fun startScan(
        targetId: String,
        onFound: (ReconnectScanMatch) -> Unit,
        onFailed: (errorCode: Int) -> Unit,
    ): Boolean {
        val scanner = scanner() ?: return false
        val cb = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                if (!result.device.address.equals(targetId, ignoreCase = true)) return
                scheduler.post { onFound(ReconnectScanMatch(result.device.address, result.rssi)) }
            }

            override fun onScanFailed(errorCode: Int) {
                scheduler.post { onFailed(errorCode) }
            }
        }
        activeCallback = cb
        scanner.startScan(
            null,
            ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
                .build(),
            cb,
        )
        Log.d(VESC_SESSION_TAG, "Reconnect scan started for $targetId")
        return true
    }

    override fun stopScan() {
        val cb = activeCallback ?: return
        activeCallback = null
        try {
            scanner()?.stopScan(cb)
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Reconnect scan stop failed: ${e.message}")
        }
    }
}
