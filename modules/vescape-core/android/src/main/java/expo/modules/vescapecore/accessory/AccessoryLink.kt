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

/**
 * How long to wait for GATT to come up before giving the OS-managed reconnect another go. Generous
 * on purpose: an Accessory that is simply out of range is the normal case, not a failure.
 */
private const val CONNECT_TIMEOUT_MS = 20_000L

/** Backoff between deliberate reconnect attempts after the link failed rather than merely dropped. */
private const val RETRY_DELAY_MS = 5_000L

/**
 * Where one enrolled Accessory's link stands. Native decides this; JS renders it and never derives
 * one from a boolean, exactly as it does for a Board.
 *
 * @parity /modules/vescape-core/ios/accessory/AccessoryLink.swift `AccessoryLinkPhase`
 * @parity /modules/vescape-core/src/index.ts `AccessoryLinkPhase`
 */
enum class AccessoryLinkPhase(val wire: String) {
    /** No link is held and none is being attempted. */
    IDLE("idle"),

    /** The radio is trying, including while the OS holds a background reconnect open. */
    CONNECTING("connecting"),

    /** GATT is up; the manifest has not been validated yet. */
    HANDSHAKING("handshaking"),

    /** Manifest validated and the session's commands are being acknowledged. */
    CONNECTED("connected"),

    /** It answered, but the session could not be kept: refused or unacknowledged commands. */
    UNAVAILABLE("unavailable"),

    /** Its manifest says this app cannot drive it. Nothing is commanded; the row explains why. */
    INCOMPATIBLE("incompatible"),
}

/**
 * A live protocol session with one enrolled Accessory.
 *
 * Long-lived, unlike [AccessoryGattHandshake]: this is the link an Accessory keeps while the rider
 * is riding, the screen is off and the JS runtime is gone. Android's own `autoConnect` reconnect is
 * what carries it across a walk out of range, so being dropped is not an error and does not reset
 * anything durable.
 *
 * Every connection is a **fresh protocol session**. A new session id goes out with the hello, the
 * request counter restarts, and the desired commands are re-sent from scratch — so a command queued
 * against the previous session can never reach this one, and an ack belonging to it is ignored
 * rather than matched against the wrong request.
 *
 * The clock is [SystemClock.elapsedRealtime]: leases and request timeouts are durations, and wall
 * clock moves under them (NTP, time zones, the rider changing the date). A lease measured on the
 * wrong clock is a light that goes dark at midnight.
 *
 * @parity /modules/vescape-core/ios/accessory/AccessoryLink.swift
 */
@SuppressLint("MissingPermission")
internal class AccessoryLink(
    private val context: Context,
    private val handler: Handler,
    /** Manifest identity this link is for. A manifest naming anything else is refused. */
    private val accessoryId: String,
    private val onChanged: () -> Unit,
    private val onManifest: (AccessoryManifest, deviceId: String) -> Unit,
) {
    var phase: AccessoryLinkPhase = AccessoryLinkPhase.IDLE
        private set

    /** Wire string for the last failure, or null while nothing is wrong. */
    var lastError: String? = null
        private set

    /** Manifest read on the current connection. Null whenever no session is established. */
    var manifest: AccessoryManifest? = null
        private set

    /** Monotonic timestamp of the last ack, for the lease the accessory is holding. */
    var lastAckAtMs: Long? = null
        private set

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

    /** Desired state per capability. Coalesced: only the latest matters, because commands are absolute. */
    private val desired = LinkedHashMap<String, AccessoryCommand>()

    /** The one request allowed to be outstanding, with the retry budget it has left. */
    private var outstanding: Outstanding? = null

    private var connectTimeout: Runnable? = null
    private var requestTimeout: Runnable? = null
    private var renewTick: Runnable? = null
    private var retry: Runnable? = null

    private data class Outstanding(
        val requestId: Int,
        val command: AccessoryCommand,
        val line: String,
        /** False until the one permitted retry has gone out with the same id. */
        val retried: Boolean,
    )

    /** Starts, or re-points at a newly discovered handle. Idempotent. */
    fun start(deviceId: String?) {
        if (deviceId != null && deviceId != this.deviceId) {
            this.deviceId = deviceId
            if (started) {
                // A different handle is a different peripheral object; the old connection cannot be
                // re-pointed at it.
                teardown()
            }
        }
        if (started) return
        started = true
        connect()
    }

    fun stop() {
        started = false
        teardown()
        setPhase(AccessoryLinkPhase.IDLE, error = null)
    }

    /**
     * Sets the desired state for one capability.
     *
     * Absolute, never incremental: the accessory is told what to be, so the same call repeated is
     * the renewal and a dropped one costs nothing but latency. An unchanged command is not re-queued
     * — the renewal tick already re-sends it, and re-queueing would burn a request id per call.
     */
    fun setDesired(command: AccessoryCommand) {
        if (desired[command.capabilityId] == command) return
        desired[command.capabilityId] = command
        // A changed state goes out immediately rather than waiting for the next renewal tick.
        if (phase == AccessoryLinkPhase.CONNECTED) pump()
    }

    fun clearDesired(capabilityId: String) {
        desired.remove(capabilityId)
    }

    // MARK: - Connection

    private fun connect() {
        val address = deviceId
        if (address == null) {
            setPhase(AccessoryLinkPhase.IDLE, error = "unknown-device")
            return
        }
        val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
        if (adapter == null || !adapter.isEnabled) {
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
        // `autoConnect = true`: the OS keeps the attempt alive across the Accessory going out of
        // range and back, without the app holding a scan or a wakelock. This is the whole reason a
        // session survives a dead JS runtime.
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
        val target = gatt
        gatt = null
        try {
            target?.disconnect()
            target?.close()
        } catch (e: Exception) {
            Log.w(TAG, "link cleanup failed: ${e.message}")
        }
    }

    /** A failed link is rebuilt from scratch rather than resumed: a broken session has no state worth keeping. */
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
                // A drop is not a failure: `autoConnect` keeps trying on its own, so the session is
                // discarded but the link stays armed and the row says "connecting".
                framer.reset()
                pendingChunks.clear()
                writeInFlight = false
                sessionId = null
                outstanding = null
                manifest = null
                lastAckAtMs = null
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

    // MARK: - Protocol session

    private fun sendHello() {
        val fresh = UUID.randomUUID().toString()
        sessionId = fresh
        // A new session starts its request numbering over, which is exactly what makes an old
        // queue harmless: nothing from the previous session shares a (session, request) pair.
        nextRequestId = AccessorySession.FIRST_COMMAND_REQUEST_ID
        outstanding = null
        pendingChunks.clear()
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
                // Another session's message is noise on a shared characteristic, not a violation.
                if (parsed.error != AccessoryHandshakeError.SESSION_MISMATCH) {
                    fail(parsed.error.wire)
                }
        }
    }

    private fun onManifestRead(read: AccessoryManifest) {
        cancel(requestTimeout); requestTimeout = null
        // Identity is checked before anything saved is trusted. A different accessory answering on
        // a remembered handle is a stale handle, never a reason to drive someone else's hardware.
        if (read.accessoryId != accessoryId) {
            fail("identity-mismatch", AccessoryLinkPhase.UNAVAILABLE)
            return
        }
        manifest = read
        val device = deviceId
        if (device != null) onManifest(read, device)
        if (read.compatibility != AccessoryCompatibility.SUPPORTED) {
            // Read, recognised, and deliberately left alone: an accessory this app cannot drive
            // stays connected only long enough to say so.
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
                lastAckAtMs = SystemClock.elapsedRealtime()
                setPhase(AccessoryLinkPhase.CONNECTED, error = null)
                pump()
            }

            is AccessoryResponse.Failed -> {
                val pending = outstanding
                if (pending != null && response.requestId != null && response.requestId != pending.requestId) return
                cancel(requestTimeout); requestTimeout = null
                outstanding = null
                // The refusal is the accessory's answer, not a broken link: stay connected and say
                // what it refused, rather than dropping a session that is otherwise healthy.
                setPhase(AccessoryLinkPhase.UNAVAILABLE, error = response.code)
            }

            AccessoryResponse.Malformed -> fail("malformed")
            AccessoryResponse.Ignored -> Unit
        }
    }

    // MARK: - Request pump

    /** Sends the next desired command that is not already the one outstanding. */
    private fun pump() {
        if (outstanding != null) return
        val session = sessionId ?: return
        val supported = manifest?.capabilities?.filter { it.supported }?.map { it.id }?.toSet() ?: return
        val next = desired.entries.firstOrNull { it.key in supported }?.value ?: return
        // Round-robin: the capability just sent goes to the back, so one capability cannot starve
        // another's renewal.
        desired.remove(next.capabilityId)
        desired[next.capabilityId] = next
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

    /**
     * One retry with the *same* request id, then the accessory is unavailable.
     *
     * Reusing the id is the point: the accessory recognises a duplicate and replays its previous
     * answer instead of applying the command twice, so a retry cannot restart an animation or
     * extend a lease twice.
     */
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

    /**
     * Re-sends the current desired state often enough that the accessory's lease never lapses while
     * the app is alive and willing. Nothing here is incremental: a renewal is the same absolute
     * command, so a missed tick costs latency and not correctness.
     */
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

    // MARK: - Writing

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
        if (!queued) fail("write-failed")
    }
}
