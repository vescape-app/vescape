package expo.modules.vescapecore.hardware

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.util.UUID

private const val TAG = "VescapeHardware"

/** Nordic UART Service, as the Vescape-HW firmware advertises it. */
private val NUS_SERVICE_UUID = UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e")
private val NUS_TX_UUID = UUID.fromString("6e400002-b5a3-f393-e0a9-e50e24dcca9e")
private val NUS_RX_UUID = UUID.fromString("6e400003-b5a3-f393-e0a9-e50e24dcca9e")
private val CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

/** Advertised name prefix the firmware uses. Boards speak NUS too, so the name is the filter. */
private const val HARDWARE_NAME_PREFIX = "Vescape-HW"

private const val REQUESTED_MTU = 517

/** How long to wait for the peer to acknowledge a write before calling it lost. */
private const val WRITE_TIMEOUT_MS = 5_000L

/**
 * How long notifications are gathered before one batch crosses into JS.
 *
 * The board can push fifty frames a second, and one JS callback per notification is enough to
 * starve the JS thread on its own — timers stop firing and the UI stops answering touches long
 * before any of that data is drawn. Buffering here costs a tenth of a second of latency and keeps
 * every frame: nothing is dropped, it just arrives in groups.
 */
private const val MESSAGE_FLUSH_MS = 100L

/**
 * How often the decimated chart series crosses into JS.
 *
 * Four redraws a second reads as continuous on a scrolling chart, and it decouples the drawing
 * cost from a link that can push fifty frames a second.
 */
private const val SERIES_FLUSH_MS = 250L

/**
 * Standalone link to a Vescape hardware device (ESP32-S3 running the `vescape-hardware` firmware).
 * Deliberately separate from the board session: this is a raw Nordic UART pipe with no VESC packet
 * framing, no reconnect state machine, and no recording.
 *
 * TODO(ios parity): Android-only for now, by request. The iOS peer has no `HardwareLink`.
 * @parity /modules/vescape-core/src/index.ts `HardwareStateEvent`
 */
@SuppressLint("MissingPermission")
object HardwareLink {
    /** Set by the Expo module so the link can push state without holding a module reference. */
    var emit: ((String, Map<String, Any?>) -> Unit)? = null

    private val handler = Handler(Looper.getMainLooper())

    private var phase = "idle"
    private var error: String? = null
    private var deviceId: String? = null
    private var deviceName: String? = null

    private var scanContext: Context? = null
    private var scanCallback: ScanCallback? = null
    private var gatt: BluetoothGatt? = null
    private var txChar: BluetoothGattCharacteristic? = null
    private var pendingWrite: ((Boolean, Int, String?) -> Unit)? = null
    private var writeTimeout: Runnable? = null
    private val pendingMessages = mutableListOf<Map<String, Any?>>()
    private var flushScheduled = false
    private val sensors = SensorLog()
    private var seriesScheduled = false

    fun state(): Map<String, Any?> = mapOf(
        "phase" to phase,
        "deviceId" to deviceId,
        "deviceName" to deviceName,
        "error" to error,
    )

    fun startScan(context: Context) {
        stopScan()
        scanContext = context.applicationContext
        val scanner = adapterScanner(context) ?: run {
            fail("Bluetooth is off or unavailable")
            return
        }
        val cb = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val name = result.scanRecord?.deviceName ?: result.device.name ?: return
                if (!name.startsWith(HARDWARE_NAME_PREFIX)) return
                emit?.invoke(
                    "onHardwareDevice",
                    mapOf(
                        "id" to result.device.address,
                        "name" to name,
                        "rssi" to result.rssi,
                    ),
                )
            }

            override fun onBatchScanResults(results: MutableList<ScanResult>) {
                results.forEach { onScanResult(ScanSettings.CALLBACK_TYPE_ALL_MATCHES, it) }
            }

            override fun onScanFailed(errorCode: Int) {
                scanCallback = null
                fail("Scan failed: $errorCode")
            }
        }
        scanCallback = cb
        scanner.startScan(
            null,
            ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(),
            cb,
        )
        error = null
        setPhase("scanning")
    }

    fun stopScan() {
        val cb = scanCallback ?: return
        val context = scanContext
        scanCallback = null
        scanContext = null
        try {
            context?.let { adapterScanner(it)?.stopScan(cb) }
        } catch (e: Exception) {
            Log.w(TAG, "scan stop failed: ${e.message}")
        }
        if (phase == "scanning") setPhase("idle")
    }

    fun connect(context: Context, id: String) {
        // Claimed before the scan is stopped: `stopScan` publishes an idle phase when it ends a
        // scan, and a listener that re-scans on idle would then race this connect and leave the
        // link reporting "scanning" while it is connected.
        phase = "connecting"
        stopScan()
        clearGatt()
        val adapter = bluetoothManager(context)?.adapter ?: run {
            fail("Bluetooth is off or unavailable")
            return
        }
        val device = try {
            adapter.getRemoteDevice(id)
        } catch (e: IllegalArgumentException) {
            fail("Unknown device address $id")
            return
        }
        deviceId = id
        deviceName = device.name
        error = null
        setPhase("connecting")
        gatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
    }

    fun disconnect() {
        clearGatt()
        deviceId = null
        deviceName = null
        error = null
        setPhase("idle")
    }

    /**
     * Writes UTF-8 bytes on the TX characteristic and reports the peer's acknowledgement.
     *
     * Deliberately a write *with* response: this is a debug console, and "the local stack queued
     * it" is not the answer the rider is looking for when nothing comes back. GATT allows one
     * outstanding write at a time, so a second send while one is in flight is refused rather than
     * queued.
     */
    fun send(text: String, onResult: (ok: Boolean, status: Int, detail: String?) -> Unit) {
        val target = gatt
        val characteristic = txChar
        if (target == null || characteristic == null) {
            onResult(false, -1, "Not connected")
            return
        }
        if (pendingWrite != null) {
            onResult(false, -1, "A write is already in flight")
            return
        }
        pendingWrite = onResult
        val timeout = Runnable { completeWrite(false, -1, "Timed out waiting for the device") }
        writeTimeout = timeout
        handler.postDelayed(timeout, WRITE_TIMEOUT_MS)

        val bytes = text.toByteArray(Charsets.UTF_8)
        val queued = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            target.writeCharacteristic(
                characteristic,
                bytes,
                BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT,
            ) == BluetoothGatt.GATT_SUCCESS
        } else {
            @Suppress("DEPRECATION")
            run {
                characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                characteristic.value = bytes
                target.writeCharacteristic(characteristic)
            }
        }
        if (!queued) completeWrite(false, -1, "The Bluetooth stack refused the write")
    }

    private fun completeWrite(ok: Boolean, status: Int, detail: String?) {
        writeTimeout?.let { handler.removeCallbacks(it) }
        writeTimeout = null
        val callback = pendingWrite ?: return
        pendingWrite = null
        callback(ok, status, detail)
    }

    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            if (g !== gatt) {
                try { g.close() } catch (e: Exception) { Log.w(TAG, "stale close: ${e.message}") }
                return
            }
            handler.post {
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    g.requestMtu(REQUESTED_MTU)
                } else {
                    clearGatt()
                    if (phase != "idle") {
                        if (status == BluetoothGatt.GATT_SUCCESS) setPhase("idle")
                        else fail("Disconnected (status $status)")
                    }
                }
            }
        }

        override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) {
            handler.post { if (g === gatt) g.discoverServices() }
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            handler.post {
                if (g !== gatt) return@post
                val service = g.getService(NUS_SERVICE_UUID) ?: run {
                    clearGatt()
                    fail("Device does not expose the Nordic UART service")
                    return@post
                }
                txChar = service.getCharacteristic(NUS_TX_UUID)
                val rx = service.getCharacteristic(NUS_RX_UUID)
                if (txChar == null || rx == null) {
                    clearGatt()
                    fail("Nordic UART characteristics missing")
                    return@post
                }
                g.setCharacteristicNotification(rx, true)
                val cccd = rx.getDescriptor(CCCD_UUID)
                if (cccd == null) {
                    setPhase("connected")
                    return@post
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    g.writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                } else {
                    @Suppress("DEPRECATION")
                    run {
                        cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                        g.writeDescriptor(cccd)
                    }
                }
            }
        }

        override fun onCharacteristicWrite(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            if (g !== gatt) return
            handler.post {
                completeWrite(
                    status == BluetoothGatt.GATT_SUCCESS,
                    status,
                    if (status == BluetoothGatt.GATT_SUCCESS) null else "GATT status $status",
                )
            }
        }

        override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            handler.post { if (g === gatt) setPhase("connected") }
        }

        // Pre-API-33 delivery path; the value-carrying overload below covers newer devices.
        override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            @Suppress("DEPRECATION")
            deliver(g, characteristic.uuid, characteristic.value ?: return)
        }

        override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
            deliver(g, characteristic.uuid, value)
        }
    }

    private fun deliver(g: BluetoothGatt, uuid: UUID, value: ByteArray) {
        if (g !== gatt || uuid != NUS_RX_UUID) return
        val text = String(value, Charsets.UTF_8)
        // Stamped here rather than at flush time, so batching never distorts the arrival times a
        // consumer measures the link's rate from.
        val atMs = System.currentTimeMillis().toDouble()
        handler.post {
            pendingMessages.add(mapOf("text" to text, "atMs" to atMs))
            if (!flushScheduled) {
                flushScheduled = true
                handler.postDelayed(::flushMessages, MESSAGE_FLUSH_MS)
            }
        }
    }

    /**
     * Turns a batch of notifications into what the screen actually shows: sensor frames go to the
     * log and leave as numbers, anything else is console text. Frames never reach the console —
     * fifty a second would scroll away every reply the board sends within a frame of it arriving.
     */
    private fun flushMessages() {
        flushScheduled = false
        if (pendingMessages.isEmpty()) return
        val batch = pendingMessages.toList()
        pendingMessages.clear()

        var frames = 0
        val lines = batch.filter { message ->
            val text = message["text"] as? String ?: return@filter false
            val atMs = (message["atMs"] as? Double)?.toLong() ?: 0L
            if (sensors.append(text, atMs)) {
                frames += 1
                false
            } else {
                true
            }
        }
        if (lines.isNotEmpty()) emit?.invoke("onHardwareMessage", mapOf("messages" to lines))
        if (frames == 0) return

        val rate = sensors.rate()
        emit?.invoke(
            "onHardwareSensor",
            mapOf(
                "keys" to sensors.keys(),
                "values" to sensors.live(),
                "hz" to rate.hz,
                "dropped" to rate.dropped,
                "readMs" to rate.readMs,
            ),
        )
        if (!seriesScheduled) {
            seriesScheduled = true
            handler.postDelayed(::flushSeries, SERIES_FLUSH_MS)
        }
    }

    private fun flushSeries() {
        seriesScheduled = false
        emit?.invoke(
            "onHardwareSeries",
            mapOf(
                "series" to sensors.series().map {
                    mapOf("key" to it.key, "points" to it.points, "min" to it.min, "max" to it.max)
                },
            ),
        )
    }

    private fun clearGatt() {
        completeWrite(false, -1, "Link closed before the write was acknowledged")
        flushMessages()
        // The history belongs to the link that gathered it: keeping it across a reconnect would
        // draw one board's readings against another's clock.
        sensors.clear()
        emit?.invoke("onHardwareSeries", mapOf("series" to emptyList<Any>()))
        txChar = null
        val g = gatt ?: return
        gatt = null
        try {
            g.disconnect()
            g.close()
        } catch (e: Exception) {
            Log.w(TAG, "gatt cleanup failed: ${e.message}")
        }
    }

    private fun bluetoothManager(context: Context): BluetoothManager? =
        context.applicationContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager

    private fun adapterScanner(context: Context) =
        bluetoothManager(context)?.adapter?.bluetoothLeScanner

    private fun fail(message: String) {
        Log.w(TAG, message)
        error = message
        setPhase("error")
    }

    private fun setPhase(next: String) {
        phase = next
        if (next != "error") error = null
        emit?.invoke("onHardwareState", state())
    }
}
