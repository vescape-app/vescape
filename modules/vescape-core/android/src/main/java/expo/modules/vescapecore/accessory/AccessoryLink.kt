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
import android.os.SystemClock
import android.util.Log
import java.util.UUID

private const val TAG = "VescapeAccessory"
private val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
private const val REQUESTED_MTU = 517
private const val ATT_WRITE_OVERHEAD = 3
private const val DEFAULT_MTU = 23

private const val CONNECT_TIMEOUT_MS = 20_000L

private const val RETRY_DELAY_MS = 5_000L

/**
 * @parity /modules/vescape-core/ios/accessory/AccessoryLink.swift `AccessoryLinkPhase`
 * @parity /modules/vescape-core/src/index.ts `AccessoryLinkPhase`
 */
enum class AccessoryLinkPhase(val wire: String) {
    IDLE("idle"),

    CONNECTING("connecting"),

    HANDSHAKING("handshaking"),

    CONNECTED("connected"),

    UNAVAILABLE("unavailable"),

    INCOMPATIBLE("incompatible"),
}

/**
 * @parity /modules/vescape-core/ios/accessory/AccessoryLink.swift
 */
@SuppressLint("MissingPermission")
internal class AccessoryLink(
    private val context: Context,
    private val handler: Handler,
    private val accessoryId: String,
    private val onChanged: () -> Unit,
    private val onManifest: (AccessoryManifest, deviceId: String) -> Unit,
    private val onReading: (AccessoryReading, receivedAtMs: Long) -> Unit = { _, _ -> },
    private val onSessionLost: () -> Unit = {},
) {
    var phase: AccessoryLinkPhase = AccessoryLinkPhase.IDLE
        private set

    var lastError: String? = null
        private set

    var manifest: AccessoryManifest? = null
        private set

    var lastAckAtMs: Long? = null
        private set

    private val appliedByCapability = HashMap<String, Map<String, String>>()

    fun appliedRateHz(capabilityId: String): Double? =
        appliedByCapability[capabilityId]?.get("rateHz")?.toDoubleOrNull()?.takeIf { it.isFinite() && it > 0.0 }

    private var deviceId: String? = null
    private var gatt: BluetoothGatt? = null
    private var writeChar: BluetoothGattCharacteristic? = null
    private val framer = AccessoryNdjsonFramer()
    private var mtu = DEFAULT_MTU
    private val pendingChunks = ArrayDeque<ByteArray>()
    private var writeInFlight = false
    private var started = false

    private var sessionId: String? = null
    private var nextRequestId = AccessorySession.FIRST_COMMAND_REQUEST_ID

    private val desired = LinkedHashMap<String, AccessoryCommand>()

    private val lastSentAtMs = HashMap<String, Long>()
    private val dirty = HashSet<String>()

    private var outstanding: Outstanding? = null

    private var connectTimeout: Runnable? = null
    private var requestTimeout: Runnable? = null
    private var renewTick: Runnable? = null
    private var retry: Runnable? = null

    private data class Outstanding(
        val requestId: Int,
        val command: AccessoryCommand,
        val line: String,
        val retried: Boolean,
    )

    fun start(deviceId: String?) {
        val movedHandle = deviceId != null && deviceId != this.deviceId
        if (movedHandle) this.deviceId = deviceId
        if (started && !movedHandle) return
        started = true
        if (movedHandle) teardown()
        connect()
    }

    fun stop() {
        started = false
        teardown()
        setPhase(AccessoryLinkPhase.IDLE, error = null)
    }

    fun setDesired(command: AccessoryCommand) {
        if (desired[command.capabilityId] == command) return
        desired[command.capabilityId] = command
        dirty.add(command.capabilityId)
        if (phase == AccessoryLinkPhase.CONNECTED) pump()
    }

    private fun connect() {
        val address = deviceId
        if (address == null) {
            setPhase(AccessoryLinkPhase.IDLE, error = "unknown-device")
            return
        }
        val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
        if (adapter == null || !adapter.isEnabled) {
            // @platform-diff iOS is told directly, through its central's state callback.
            setPhase(AccessoryLinkPhase.CONNECTING, error = "bluetooth-unavailable")
            scheduleRetry()
            return
        }
        val device = try {
            adapter.getRemoteDevice(address)
        } catch (e: IllegalArgumentException) {
            setPhase(AccessoryLinkPhase.IDLE, error = "unknown-device")
            return
        }
        setPhase(AccessoryLinkPhase.CONNECTING, error = null)
        armConnectTimeout()
        gatt = device.connectGatt(context, true, callback, BluetoothDevice.TRANSPORT_LE)
    }

    private fun teardown() {
        cancel(connectTimeout); connectTimeout = null
        cancel(requestTimeout); requestTimeout = null
        cancel(renewTick); renewTick = null
        cancel(retry); retry = null
        framer.reset()
        pendingChunks.clear()
        writeInFlight = false
        writeChar = null
        sessionId = null
        outstanding = null
        manifest = null
        lastAckAtMs = null
        appliedByCapability.clear()
        onSessionLost()
        val target = gatt
        gatt = null
        try {
            target?.disconnect()
            target?.close()
        } catch (e: Exception) {
            Log.w(TAG, "link cleanup failed: ${e.message}")
        }
    }

    private fun fail(error: String, phase: AccessoryLinkPhase = AccessoryLinkPhase.UNAVAILABLE) {
        teardown()
        setPhase(phase, error)
        if (started) scheduleRetry()
    }

    private fun scheduleRetry() {
        if (!started) return
        cancel(retry)
        val runnable = Runnable { if (started && gatt == null) connect() }
        retry = runnable
        handler.postDelayed(runnable, RETRY_DELAY_MS)
    }

    private fun armConnectTimeout() {
        cancel(connectTimeout)
        val runnable = Runnable { fail("timeout", AccessoryLinkPhase.CONNECTING) }
        connectTimeout = runnable
        handler.postDelayed(runnable, CONNECT_TIMEOUT_MS)
    }

    private fun cancel(runnable: Runnable?) {
        runnable?.let { handler.removeCallbacks(it) }
    }

    private fun setPhase(next: AccessoryLinkPhase, error: String?) {
        if (phase == next && lastError == error) return
        phase = next
        lastError = error
        onChanged()
    }

    private val callback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            handler.post {
                if (g !== gatt) {
                    try { g.close() } catch (e: Exception) { Log.w(TAG, "stale close: ${e.message}") }
                    return@post
                }
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    cancel(connectTimeout); connectTimeout = null
                    setPhase(AccessoryLinkPhase.HANDSHAKING, error = null)
                    g.requestMtu(REQUESTED_MTU)
                    return@post
                }
                framer.reset()
                pendingChunks.clear()
                writeInFlight = false
                sessionId = null
                outstanding = null
                manifest = null
                lastAckAtMs = null
                appliedByCapability.clear()
                onSessionLost()
                cancel(requestTimeout); requestTimeout = null
                cancel(renewTick); renewTick = null
                if (started) {
                    armConnectTimeout()
                    setPhase(AccessoryLinkPhase.CONNECTING, error = null)
                } else {
                    setPhase(AccessoryLinkPhase.IDLE, error = null)
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
                    ?: return@post fail("service-missing")
                val notify = service.getCharacteristic(AccessoryProtocol.NOTIFY_UUID)
                val write = service.getCharacteristic(AccessoryProtocol.WRITE_UUID)
                if (notify == null || write == null) return@post fail("service-missing")
                writeChar = write
                g.setCharacteristicNotification(notify, true)
                val cccd = notify.getDescriptor(CCCD_UUID) ?: return@post fail("service-missing")
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
                if (status != BluetoothGatt.GATT_SUCCESS) return@post fail("write-failed")
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

    private fun sendHello() {
        val fresh = UUID.randomUUID().toString()
        sessionId = fresh
        nextRequestId = AccessorySession.FIRST_COMMAND_REQUEST_ID
        outstanding = null
        pendingChunks.clear()
        lastSentAtMs.clear()
        dirty.addAll(desired.keys)
        write(AccessoryProtocol.encodeHello(fresh))
        cancel(requestTimeout)
        val runnable = Runnable { fail("timeout") }
        requestTimeout = runnable
        handler.postDelayed(runnable, AccessoryProtocol.HANDSHAKE_TIMEOUT_MS)
    }

    private fun deliver(g: BluetoothGatt, uuid: UUID, value: ByteArray) {
        if (uuid != AccessoryProtocol.NOTIFY_UUID) return
        handler.post {
            if (g !== gatt) return@post
            val session = sessionId ?: return@post
            val result = framer.feed(value)
            for (line in result.lines) {
                if (manifest == null) {
                    handleHandshakeLine(line, session)
                } else {
                    handleSessionLine(line, session)
                }
                if (gatt !== g) return@post
            }
            result.failure?.let { fail(it.wire) }
        }
    }

    private fun handleHandshakeLine(line: String, session: String) {
        when (val parsed = AccessoryProtocol.parseManifest(line, session)) {
            is ManifestResult.Ok -> onManifestRead(parsed.manifest)
            is ManifestResult.Failed ->
                if (parsed.error != AccessoryHandshakeError.SESSION_MISMATCH) {
                    fail(parsed.error.wire)
                }
        }
    }

    private fun onManifestRead(read: AccessoryManifest) {
        cancel(requestTimeout); requestTimeout = null
        if (read.accessoryId != accessoryId) {
            fail("identity-mismatch", AccessoryLinkPhase.UNAVAILABLE)
            return
        }
        manifest = read
        val device = deviceId
        if (device != null) onManifest(read, device)
        if (read.compatibility != AccessoryCompatibility.SUPPORTED) {
            setPhase(AccessoryLinkPhase.INCOMPATIBLE, error = read.compatibility.wire)
            return
        }
        setPhase(AccessoryLinkPhase.CONNECTED, error = null)
        armRenewal()
        pump()
    }

    private fun handleSessionLine(line: String, session: String) {
        when (val response = AccessoryResponse.parse(line, session)) {
            is AccessoryResponse.Ack -> {
                val pending = outstanding ?: return
                if (response.requestId != pending.requestId) return
                cancel(requestTimeout); requestTimeout = null
                outstanding = null
                appliedByCapability[response.capabilityId] = response.applied
                lastAckAtMs = SystemClock.elapsedRealtime()
                setPhase(AccessoryLinkPhase.CONNECTED, error = null)
                pump()
            }

            is AccessoryResponse.Failed -> {
                val pending = outstanding
                if (pending != null && response.requestId != null && response.requestId != pending.requestId) return
                cancel(requestTimeout); requestTimeout = null
                outstanding = null
                setPhase(AccessoryLinkPhase.UNAVAILABLE, error = response.code)
            }

            is AccessoryResponse.Sample -> {
                onReading(response.reading, SystemClock.elapsedRealtime())
            }

            AccessoryResponse.Malformed -> fail("malformed")
            AccessoryResponse.Ignored -> Unit
        }
    }

    private fun pump() {
        if (outstanding != null) return
        val session = sessionId ?: return
        val supported = manifest?.capabilities?.filter { it.supported }?.map { it.id }?.toSet() ?: return
        val now = SystemClock.elapsedRealtime()
        val capabilityId = desired.keys.firstOrNull { id ->
            id in supported && (
                id in dirty ||
                    now - (lastSentAtMs[id] ?: Long.MIN_VALUE / 2) >= AccessorySession.RENEW_INTERVAL_MS
                )
        } ?: return
        val next = desired.getValue(capabilityId)
        desired.remove(capabilityId)
        desired[capabilityId] = next
        dirty.remove(capabilityId)
        lastSentAtMs[capabilityId] = now
        val requestId = nextRequestId++
        val line = next.encode(session, requestId)
        outstanding = Outstanding(requestId, next, line, retried = false)
        write(line)
        armRequestTimeout()
    }

    private fun armRequestTimeout() {
        cancel(requestTimeout)
        val runnable = Runnable { onRequestTimedOut() }
        requestTimeout = runnable
        handler.postDelayed(runnable, AccessorySession.REQUEST_TIMEOUT_MS)
    }

    private fun onRequestTimedOut() {
        val pending = outstanding ?: return
        if (!pending.retried) {
            outstanding = pending.copy(retried = true)
            write(pending.line)
            armRequestTimeout()
            return
        }
        fail("timeout")
    }

    private fun armRenewal() {
        cancel(renewTick)
        val runnable = object : Runnable {
            override fun run() {
                if (phase == AccessoryLinkPhase.CONNECTED) pump()
                handler.postDelayed(this, AccessorySession.RENEW_INTERVAL_MS)
            }
        }
        renewTick = runnable
        handler.postDelayed(runnable, AccessorySession.RENEW_INTERVAL_MS)
    }

    private fun write(line: String) {
        val payload = (line + "\n").toByteArray(Charsets.UTF_8)
        val limit = (mtu - ATT_WRITE_OVERHEAD).coerceAtLeast(20)
        var offset = 0
        while (offset < payload.size) {
            val end = minOf(offset + limit, payload.size)
            pendingChunks.addLast(payload.copyOfRange(offset, end))
            offset = end
        }
        drain()
    }

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
        if (!queued) fail("write-failed")
    }
}
