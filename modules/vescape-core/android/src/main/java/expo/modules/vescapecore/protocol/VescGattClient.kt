package expo.modules.vescapecore.protocol

import expo.modules.vescapecore.recording.SessionRecorder
import expo.modules.vescapecore.service.VESC_SESSION_TAG

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.content.Context
import android.os.Build
import android.os.Handler
import android.util.Log
import java.util.UUID

private val NUS_SERVICE_UUID = UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e")
private val NUS_TX_UUID = UUID.fromString("6e400002-b5a3-f393-e0a9-e50e24dcca9e")
private val NUS_RX_UUID = UUID.fromString("6e400003-b5a3-f393-e0a9-e50e24dcca9e")
private val CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

internal interface VescGattListener {
    fun onGattConnected()
    fun onGattSubscribing()
    fun onGattDisconnected(status: Int, intentional: Boolean)
    fun onGattReady()
    fun onGattFailure(code: String, message: String)
    fun onGattFrameChunk(chunk: ByteArray)
}

/**
 * Transport seam under [BoardSessionController] (ADR 0024): everything the controller calls on the
 * board link beyond the [VescGattListener] callbacks. The real [VescGattClient] speaks GATT; the
 * dev-mode ReplayTransport plays a Debug Recording through the same surface.
 * @parity /modules/vescape-core/ios/protocol/VescGattClient.swift `SessionTransport`
 */
internal interface SessionTransport {
    fun connect(deviceId: String)
    fun sendPayload(payload: ByteArray): Boolean
    fun sendRemoteInput(payload: ByteArray, urgent: Boolean = false): Boolean
    fun clear(markIntentional: Boolean = true)
}

// @parity /modules/vescape-core/ios/protocol/VescGattClient.swift
@SuppressLint("MissingPermission")
internal class VescGattClient(
    private val context: Context,
    private val handler: Handler,
    private val recorder: () -> SessionRecorder?,
    private val listener: VescGattListener,
    private val dispatchListener: ((() -> Unit) -> Unit) = { it() },
) : SessionTransport {
    private var gatt: BluetoothGatt? = null
    private var txChar: BluetoothGattCharacteristic? = null
    private var pendingCccdWrites = 0
    private var cccdTimeout: Runnable? = null
    private var writeRetry: Runnable? = null
    private var intentionalDisconnect = false
    private val writeQueue = VescWriteQueue()

    override fun connect(deviceId: String) {
        val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
        val device = adapter.getRemoteDevice(deviceId)
        Log.d(VESC_SESSION_TAG, "gatt connect request device=${device.address}")
        // A lingering gatt from a previous attempt keeps delivering callbacks on the
        // shared callback object and would race this connection; tear it down first.
        if (gatt != null) clear(markIntentional = true)
        // Each connection starts unintentional; the teardown flag belongs to the gatt
        // we just cleared, not to the new one.
        intentionalDisconnect = false
        gatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
    }

    override fun sendPayload(payload: ByteArray): Boolean {
        if (gatt == null || txChar == null) return false
        writeQueue.enqueueNormal(VescPacketCodec.encode(payload))
        return drainWriteQueue()
    }

    /**
     * Enqueue transient remote input (tilt or Board Move). Only latest unsent value survives, so an
     * emergency neutral command cannot sit behind stale tilt commands.
     */
    override fun sendRemoteInput(payload: ByteArray, urgent: Boolean): Boolean {
        if (gatt == null || txChar == null) return false
        writeQueue.replaceRemoteInput(VescPacketCodec.encode(payload), urgent)
        return drainWriteQueue()
    }

    override fun clear(markIntentional: Boolean) {
        try {
            cancelCccdTimeout()
            writeRetry?.let { handler.removeCallbacks(it) }
            writeRetry = null
            writeQueue.clear()
            if (markIntentional && gatt != null) intentionalDisconnect = true
            gatt?.disconnect()
            gatt?.close()
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "GATT cleanup failed: ${e.message}")
        }
        gatt = null
        txChar = null
    }

    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            Log.d(VESC_SESSION_TAG, "onConnectionStateChange status=$status newState=$newState")
            // Late callback from a previous (already-replaced/cleared) connection. Close it
            // and leave the current session's state untouched — otherwise a stale disconnect
            // would clobber the live gatt and freeze telemetry.
            if (gatt !== this@VescGattClient.gatt) {
                try { gatt.close() } catch (e: Exception) { Log.w(VESC_SESSION_TAG, "stale gatt close failed: ${e.message}") }
                return
            }
            recorder()?.recordState("gatt:$newState", mapOf("status" to status))
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    dispatchListener { listener.onGattConnected() }
                    val requested = gatt.requestMtu(517)
                    Log.d(VESC_SESSION_TAG, "gatt requestMtu requested=$requested")
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    val wasIntentional = intentionalDisconnect
                    clear(markIntentional = false)
                    if (wasIntentional) intentionalDisconnect = false
                    dispatchListener { listener.onGattDisconnected(status, wasIntentional) }
                }
            }
        }

        override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
            if (gatt !== this@VescGattClient.gatt) return
            Log.d(VESC_SESSION_TAG, "onMtuChanged mtu=$mtu status=$status")
            val discoveryStarted = gatt.discoverServices()
            Log.d(VESC_SESSION_TAG, "gatt discoverServices started=$discoveryStarted")
            if (!discoveryStarted) {
                dispatchListener { listener.onGattFailure("DISCOVERY_FAILED", "Could not start service discovery") }
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            if (gatt !== this@VescGattClient.gatt) return
            Log.d(VESC_SESSION_TAG, "onServicesDiscovered status=$status")
            dispatchListener { listener.onGattSubscribing() }
            if (status != BluetoothGatt.GATT_SUCCESS) {
                dispatchListener { listener.onGattFailure("DISCOVERY_FAILED", "Service discovery failed status=$status") }
                return
            }
            val service = gatt.getService(NUS_SERVICE_UUID)
            val tx = service?.getCharacteristic(NUS_TX_UUID)
            val rx = service?.getCharacteristic(NUS_RX_UUID)
            if (service == null || tx == null || rx == null) {
                dispatchListener { listener.onGattFailure("NO_CHAR", "NUS service/characteristics not found") }
                return
            }
            txChar = tx
            val highPriority = gatt.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH)
            Log.d(VESC_SESSION_TAG, "gatt requestConnectionPriority high=$highPriority")
            val rxNotify = gatt.setCharacteristicNotification(rx, true)
            val txNotify = gatt.setCharacteristicNotification(tx, true)
            Log.d(VESC_SESSION_TAG, "gatt set notifications rx=$rxNotify tx=$txNotify")

            val rxCccd = rx.getDescriptor(CCCD_UUID)
            if (rxCccd == null) {
                dispatchListener { listener.onGattReady() }
                return
            }
            pendingCccdWrites = 1
            if (tx.getDescriptor(CCCD_UUID) != null) pendingCccdWrites = 2
            Log.d(VESC_SESSION_TAG, "gatt cccd writes pending=$pendingCccdWrites")
            writeCccd(gatt, rxCccd)

            cccdTimeout = Runnable {
                Log.w(VESC_SESSION_TAG, "CCCD ack timeout, resolving connect pending=$pendingCccdWrites")
                dispatchListener { listener.onGattReady() }
            }
            handler.postDelayed(cccdTimeout!!, 4000)
        }

        override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            if (gatt !== this@VescGattClient.gatt) return
            if (descriptor.uuid != CCCD_UUID) return
            Log.d(VESC_SESSION_TAG, "onDescriptorWrite status=$status pendingBefore=$pendingCccdWrites")
            pendingCccdWrites--
            if (pendingCccdWrites > 0) {
                val txCccd = gatt.getService(NUS_SERVICE_UUID)
                    ?.getCharacteristic(NUS_TX_UUID)
                    ?.getDescriptor(CCCD_UUID)
                if (txCccd != null) {
                    writeCccd(gatt, txCccd)
                    return
                }
            }
            cancelCccdTimeout()
            dispatchListener { listener.onGattReady() }
        }

        /** API 33+ signature. Below 33 the framework calls the deprecated 2-param peer instead. */
        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray,
        ) {
            handleNotification(gatt, characteristic, value)
        }

        @Deprecated("Deprecated in Java")
        @Suppress("DEPRECATION")
        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
        ) {
            handleNotification(gatt, characteristic, characteristic.value ?: return)
        }

        private fun handleNotification(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray,
        ) {
            if (gatt !== this@VescGattClient.gatt) return
            if (characteristic.uuid == NUS_RX_UUID || characteristic.uuid == NUS_TX_UUID) {
                val chunk = value.copyOf()
                dispatchListener { listener.onGattFrameChunk(chunk) }
            }
        }

        override fun onCharacteristicWrite(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            status: Int,
        ) {
            if (gatt !== this@VescGattClient.gatt || characteristic.uuid != NUS_TX_UUID) return
            val completed = writeQueue.completeInFlight()
            val bytes = completed?.bytes
            if (status != BluetoothGatt.GATT_SUCCESS) {
                Log.w(VESC_SESSION_TAG, "gatt write callback failed status=$status bytes=${bytes?.size}")
            }
            drainWriteQueue()
        }
    }

    /** Android permits one characteristic write at a time. Serializing all writes
     * prevents telemetry polling and held remote controls from dropping each other. */
    private fun drainWriteQueue(): Boolean {
        val g = gatt ?: return false
        val tx = txChar ?: return false
        val write = writeQueue.startNext() ?: return true
        val bytes = write.bytes
        writeRetry?.let { handler.removeCallbacks(it) }
        writeRetry = null
        val ok = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            g.writeCharacteristic(
                tx,
                bytes,
                BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT,
            ) == BluetoothStatusCodes.SUCCESS
        } else {
            @Suppress("DEPRECATION")
            run {
                tx.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                tx.value = bytes
                g.writeCharacteristic(tx)
            }
        }
        if (!ok) {
            writeQueue.retryInFlight()
            Log.w(VESC_SESSION_TAG, "gatt writeCharacteristic failed bytes=${bytes.size}; retrying")
            val retry = Runnable { drainWriteQueue() }
            writeRetry = retry
            handler.postDelayed(retry, 25L)
            return false
        }
        recorder()?.recordChunk("tx", bytes)
        return ok
    }

    private fun writeCccd(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor) {
        val ok = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            gatt.writeDescriptor(descriptor, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) ==
                BluetoothStatusCodes.SUCCESS
        } else {
            @Suppress("DEPRECATION")
            run {
                descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                gatt.writeDescriptor(descriptor)
            }
        }
        Log.d(VESC_SESSION_TAG, "gatt writeCccd started=$ok")
    }

    private fun cancelCccdTimeout() {
        cccdTimeout?.let { handler.removeCallbacks(it) }
        cccdTimeout = null
    }
}
