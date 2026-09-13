package expo.modules.vescapecore.accessory

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.os.Build
import android.os.Handler
import android.util.Log
import java.util.UUID

private const val TAG = "VescapeAccessory"
private val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
private const val REQUESTED_MTU = 517

/** ATT overhead on a write: the negotiated MTU minus the opcode and handle. */
private const val ATT_WRITE_OVERHEAD = 3

/** Conservative default until the peer answers `onMtuChanged`. */
private const val DEFAULT_MTU = 23

/** Connect, discover and subscribe must all land before the handshake is even sent. */
private const val CONNECT_TIMEOUT_MS = 10_000L

/**
 * One Accessory discovery handshake: connect, subscribe, write `hello`, read the manifest back,
 * disconnect. Nothing else is ever written on the link.
 *
 * That single-write shape is the guarantee behind "no control activates from discovery": the class
 * has no path that can emit `configure` or `state`, so inspecting an Accessory cannot start a
 * measurement or change a light. The operational session is a separate concern built on top of the
 * same protocol in later slices.
 *
 * Short-lived by design — it is torn down the moment it has an answer, so discovery never holds a
 * connection an Accessory's real session would have to fight for.
 *
 * @parity /modules/vescape-core/ios/accessory/AccessoryGattHandshake.swift
 */
@SuppressLint("MissingPermission")
internal class AccessoryGattHandshake(
    private val context: Context,
    private val handler: Handler,
    private val deviceId: String,
    private val sessionId: String,
    private val onFinished: (AccessoryHandshakeOutcome) -> Unit,
) {
    private var gatt: BluetoothGatt? = null
    private var writeChar: BluetoothGattCharacteristic? = null
    private val framer = AccessoryNdjsonFramer()
    private var mtu = DEFAULT_MTU
    private val pendingChunks = ArrayDeque<ByteArray>()
    private var writeInFlight = false
    private var timeout: Runnable? = null
    private var finished = false
    private var advertisedName: String? = null

    fun start() {
        val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
        if (adapter == null || !adapter.isEnabled) {
            finish(AccessoryHandshakeOutcome.Failed("bluetooth-unavailable"))
            return
        }
        val device = try {
            adapter.getRemoteDevice(deviceId)
        } catch (e: IllegalArgumentException) {
            finish(AccessoryHandshakeOutcome.Failed("connect-failed"))
            return
        }
        advertisedName = device.name
        arm(CONNECT_TIMEOUT_MS, "timeout")
        gatt = device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE)
    }

    fun cancel() = finish(AccessoryHandshakeOutcome.Failed("cancelled"))

    private fun arm(delayMs: Long, error: String) {
        timeout?.let { handler.removeCallbacks(it) }
        val runnable = Runnable { finish(AccessoryHandshakeOutcome.Failed(error)) }
        timeout = runnable
        handler.postDelayed(runnable, delayMs)
    }

    private fun finish(outcome: AccessoryHandshakeOutcome) {
        if (finished) return
        finished = true
        timeout?.let { handler.removeCallbacks(it) }
        timeout = null
        framer.reset()
        pendingChunks.clear()
        writeChar = null
        val target = gatt
        gatt = null
        try {
            target?.disconnect()
            target?.close()
        } catch (e: Exception) {
            Log.w(TAG, "gatt cleanup failed: ${e.message}")
        }
        onFinished(
            when (outcome) {
                is AccessoryHandshakeOutcome.Ok -> outcome.copy(advertisedName = advertisedName)
                is AccessoryHandshakeOutcome.Failed -> outcome.copy(advertisedName = advertisedName)
            },
        )
    }

    private val callback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            // Posted before anything is read: every field this class keeps lives on the main looper,
            // and GATT callbacks arrive on a binder thread.
            handler.post {
                if (g !== gatt) {
                    try { g.close() } catch (e: Exception) { Log.w(TAG, "stale close: ${e.message}") }
                    return@post
                }
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    g.requestMtu(REQUESTED_MTU)
                } else {
                    finish(AccessoryHandshakeOutcome.Failed("connect-failed"))
                }
            }
        }

        override fun onMtuChanged(g: BluetoothGatt, negotiated: Int, status: Int) {
            handler.post {
                if (g !== gatt) return@post
                if (negotiated > 0) mtu = negotiated
                g.discoverServices()
            }
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            handler.post {
                if (g !== gatt) return@post
                val service = g.getService(AccessoryProtocol.SERVICE_UUID)
                    ?: return@post finish(AccessoryHandshakeOutcome.Failed("service-missing"))
                val notify = service.getCharacteristic(AccessoryProtocol.NOTIFY_UUID)
                val write = service.getCharacteristic(AccessoryProtocol.WRITE_UUID)
                if (notify == null || write == null) {
                    return@post finish(AccessoryHandshakeOutcome.Failed("service-missing"))
                }
                writeChar = write
                g.setCharacteristicNotification(notify, true)
                val cccd = notify.getDescriptor(CCCD_UUID)
                    ?: return@post finish(AccessoryHandshakeOutcome.Failed("service-missing"))
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

        override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            handler.post {
                if (g !== gatt) return@post
                sendHello()
            }
        }

        override fun onCharacteristicWrite(
            g: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            status: Int,
        ) {
            handler.post {
                if (g !== gatt) return@post
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    return@post finish(AccessoryHandshakeOutcome.Failed("write-failed"))
                }
                writeInFlight = false
                drain()
            }
        }

        @Suppress("DEPRECATION")
        override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            deliver(g, characteristic.uuid, characteristic.value ?: return)
        }

        override fun onCharacteristicChanged(
            g: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray,
        ) {
            deliver(g, characteristic.uuid, value)
        }
    }

    /** Subscribed and ready: write the one line discovery is allowed to send. */
    private fun sendHello() {
        if (pendingChunks.isNotEmpty() || writeInFlight) return
        val payload = (AccessoryProtocol.encodeHello(sessionId) + "\n").toByteArray(Charsets.UTF_8)
        val limit = (mtu - ATT_WRITE_OVERHEAD).coerceAtLeast(20)
        var offset = 0
        while (offset < payload.size) {
            val end = minOf(offset + limit, payload.size)
            pendingChunks.addLast(payload.copyOfRange(offset, end))
            offset = end
        }
        // The clock starts at the request, not at connect: a slow connect has its own budget.
        arm(AccessoryProtocol.HANDSHAKE_TIMEOUT_MS, "timeout")
        drain()
    }

    /** One outstanding GATT write at a time; the chunks of one line stay in order. */
    private fun drain() {
        if (writeInFlight) return
        val target = gatt ?: return
        val characteristic = writeChar ?: return
        val chunk = pendingChunks.removeFirstOrNull() ?: return
        writeInFlight = true
        val queued = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            target.writeCharacteristic(
                characteristic,
                chunk,
                BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT,
            ) == BluetoothGatt.GATT_SUCCESS
        } else {
            @Suppress("DEPRECATION")
            run {
                characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                characteristic.value = chunk
                target.writeCharacteristic(characteristic)
            }
        }
        if (!queued) finish(AccessoryHandshakeOutcome.Failed("write-failed"))
    }

    private fun deliver(g: BluetoothGatt, uuid: UUID, value: ByteArray) {
        if (uuid != AccessoryProtocol.NOTIFY_UUID) return
        handler.post {
            if (finished || g !== gatt) return@post
            val result = framer.feed(value)
            for (line in result.lines) {
                when (val parsed = AccessoryProtocol.parseManifest(line, sessionId)) {
                    is ManifestResult.Ok ->
                        return@post finish(AccessoryHandshakeOutcome.Ok(parsed.manifest))
                    is ManifestResult.Failed -> {
                        // A message from another session is noise on a shared characteristic, not a
                        // protocol violation: keep waiting for the manifest this hello asked for.
                        if (parsed.error != AccessoryHandshakeError.SESSION_MISMATCH) {
                            return@post finish(AccessoryHandshakeOutcome.Failed(parsed.error.wire))
                        }
                    }
                }
            }
            result.failure?.let { return@post finish(AccessoryHandshakeOutcome.Failed(it.wire)) }
        }
    }
}

/** What one handshake produced, ready to cross the bridge. */
internal sealed class AccessoryHandshakeOutcome {
    abstract val advertisedName: String?

    data class Ok(
        val manifest: AccessoryManifest,
        override val advertisedName: String? = null,
    ) : AccessoryHandshakeOutcome()

    data class Failed(
        val error: String,
        override val advertisedName: String? = null,
    ) : AccessoryHandshakeOutcome()
}
