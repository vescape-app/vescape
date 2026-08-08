package expo.modules.vescapecore.ow

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattService
import android.content.Context
import android.os.Build
import android.os.Handler
import android.util.Log
import java.io.ByteArrayOutputStream
import java.util.UUID

private const val TAG = "OwGattClient"
private const val CONNECT_TIMEOUT_MS = 10_000L
private const val OP_TIMEOUT_MS = 5_000L
private const val HANDSHAKE_TIMEOUT_MS = 6_000L
private const val KEEP_ALIVE_MS = 15_000L
private const val UNLOCK_CHALLENGE_BYTES = 20

/**
 * OneWheel session phases, wire strings for the JS mirror.
 *
 * @parity /modules/vescape-core/src/index.ts `OwPhase`
 */
internal enum class OwPhase(val wire: String) {
  Connecting("connecting"),
  Unlocking("unlocking"),
  Locked("locked"),
  Ready("ready"),
  Disconnected("disconnected"),
  Error("error"),
}

/**
 * PoC OneWheel GATT client: connects, performs the firmware-lock handshake (local MD5 for
 * firmware <= 4140, otherwise reports `locked` so the UI can walk the rider through a jumpstart),
 * then reads every characteristic the board exposes and subscribes to the live ones.
 *
 * Serialized GATT op queue — Android allows exactly one outstanding GATT operation. All state
 * changes run on the supplied handler (mirrors the VESC client's threading model).
 *
 * TODO(iOS parity): OneWheel PoC is Android-only; mirror in ios/ow/ when promoted beyond PoC.
 */
@SuppressLint("MissingPermission") // permissions are requested at the JS/RN layer
internal class OwGattClient(
  private val context: Context,
  private val handler: Handler,
  private val device: BluetoothDevice,
  private val listener: Listener,
) {
  internal interface Listener {
    /** Full snapshot, re-emitted on every change. Keys mirror `OwStateEvent` on the TS side. */
    fun onState(state: Map<String, Any?>)
    /** One characteristic read/notification. Keys mirror `OwCharacteristicEvent` on the TS side. */
    fun onCharacteristic(payload: Map<String, Any?>)
  }

  private sealed interface GattOp {
    val label: String
    fun start(gatt: BluetoothGatt): Boolean
  }

  private inner class ReadOp(val char: BluetoothGattCharacteristic) : GattOp {
    override val label = "read ${char.uuid}"
    override fun start(gatt: BluetoothGatt) = gatt.readCharacteristic(char)
  }

  private inner class WriteOp(val char: BluetoothGattCharacteristic, val bytes: ByteArray) : GattOp {
    override val label = "write ${char.uuid}"
    override fun start(gatt: BluetoothGatt): Boolean {
      return if (Build.VERSION.SDK_INT >= 33) {
        gatt.writeCharacteristic(
          char,
          bytes,
          BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT,
        ) == BluetoothGatt.GATT_SUCCESS
      } else {
        @Suppress("DEPRECATION")
        char.value = bytes
        @Suppress("DEPRECATION")
        gatt.writeCharacteristic(char)
      }
    }
  }

  private inner class NotifyOp(val char: BluetoothGattCharacteristic) : GattOp {
    override val label = "notify ${char.uuid}"
    override fun start(gatt: BluetoothGatt): Boolean {
      gatt.setCharacteristicNotification(char, true)
      val cccd = char.getDescriptor(OW_CCCD_UUID) ?: return false
      return if (Build.VERSION.SDK_INT >= 33) {
        gatt.writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) ==
          BluetoothGatt.GATT_SUCCESS
      } else {
        @Suppress("DEPRECATION")
        cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        @Suppress("DEPRECATION")
        gatt.writeDescriptor(cccd)
      }
    }
  }

  private var gatt: BluetoothGatt? = null
  private var phase = OwPhase.Connecting
  private var service: BluetoothGattService? = null

  private val opQueue = ArrayDeque<GattOp>()
  private var opInFlight: GattOp? = null
  private var afterDrain: (() -> Unit)? = null
  private var opWatchdog: Runnable? = null

  private var firmwareRevision: Int? = null
  private var firmwareBytes: ByteArray? = null
  private var hardwareRevision: Int? = null
  private var serial: Int? = null
  private var rideMode: Int? = null
  private var speedKmh: Double? = null
  private var batteryPercent: Int? = null
  private var stateMessage: String? = null

  private val challengeBuffer = ByteArrayOutputStream()
  private var unlockAttempted = false
  private var handshakeTimeout: Runnable? = null
  private var keepAlive: Runnable? = null
  private var connectTimeout: Runnable? = null
  private var cleared = false

  fun connect() {
    emitState()
    connectTimeout = Runnable {
      Log.w(TAG, "connect timeout")
      fail("Connect timed out")
    }
    handler.postDelayed(connectTimeout!!, CONNECT_TIMEOUT_MS)
    val gatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
    this.gatt = gatt
  }

  /** Idempotent teardown; safe to call from any module lifecycle hook. */
  fun clear() {
    cleared = true
    connectTimeout?.let { handler.removeCallbacks(it) }
    handshakeTimeout?.let { handler.removeCallbacks(it) }
    keepAlive?.let { handler.removeCallbacks(it) }
    opWatchdog?.let { handler.removeCallbacks(it) }
    opQueue.clear()
    opInFlight = null
    afterDrain = null
    try {
      gatt?.disconnect()
      gatt?.close()
    } catch (e: Exception) {
      Log.w(TAG, "gatt close failed: ${e.message}")
    }
    gatt = null
  }

  private val gattCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      if (gatt !== this@OwGattClient.gatt) return
      handler.post {
        if (cleared || gatt !== this@OwGattClient.gatt) return@post
        when (newState) {
          BluetoothGatt.STATE_CONNECTED -> {
            connectTimeout?.let { handler.removeCallbacks(it) }
            Log.d(TAG, "connected, discovering services")
            gatt.discoverServices()
          }
          BluetoothGatt.STATE_DISCONNECTED -> {
            if (phase != OwPhase.Error) {
              phase = OwPhase.Disconnected
              emitState()
            }
            clear()
          }
        }
      }
    }

    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
      if (gatt !== this@OwGattClient.gatt) return
      handler.post {
        if (cleared || gatt !== this@OwGattClient.gatt) return@post
        val found = gatt.getService(OW_SERVICE_UUID)
        if (found == null) {
          fail("OneWheel service not found on this device")
          return@post
        }
        service = found
        Log.d(TAG, "OW service found, ${found.characteristics.size} characteristics")
        startInfoPhase(found)
      }
    }

    /** API 33+ signature. Below 33 the framework calls the deprecated 3-param peer instead. */
    override fun onCharacteristicRead(
      gatt: BluetoothGatt,
      char: BluetoothGattCharacteristic,
      value: ByteArray,
      status: Int,
    ) {
      if (gatt !== this@OwGattClient.gatt) return
      handler.post {
        if (cleared || gatt !== this@OwGattClient.gatt) return@post
        handleValue(char.uuid, value)
        completeOp()
      }
    }

    @Deprecated("Deprecated in Java")
    @Suppress("DEPRECATION")
    override fun onCharacteristicRead(gatt: BluetoothGatt, char: BluetoothGattCharacteristic, status: Int) {
      if (gatt !== this@OwGattClient.gatt) return
      val value = char.value ?: ByteArray(0)
      handler.post {
        if (cleared || gatt !== this@OwGattClient.gatt) return@post
        handleValue(char.uuid, value)
        completeOp()
      }
    }

    /** API 33+ signature. Below 33 the framework calls the deprecated 2-param peer instead. */
    override fun onCharacteristicChanged(
      gatt: BluetoothGatt,
      char: BluetoothGattCharacteristic,
      value: ByteArray,
    ) {
      if (gatt !== this@OwGattClient.gatt) return
      handler.post {
        if (cleared || gatt !== this@OwGattClient.gatt) return@post
        handleNotify(char.uuid, value)
      }
    }

    @Deprecated("Deprecated in Java")
    @Suppress("DEPRECATION")
    override fun onCharacteristicChanged(gatt: BluetoothGatt, char: BluetoothGattCharacteristic) {
      if (gatt !== this@OwGattClient.gatt) return
      val value = char.value ?: return
      handler.post {
        if (cleared || gatt !== this@OwGattClient.gatt) return@post
        handleNotify(char.uuid, value)
      }
    }

    override fun onCharacteristicWrite(
      gatt: BluetoothGatt,
      char: BluetoothGattCharacteristic,
      status: Int,
    ) {
      if (gatt !== this@OwGattClient.gatt) return
      handler.post {
        if (cleared || gatt !== this@OwGattClient.gatt) return@post
        completeOp()
      }
    }

    /** The API 33+ 4-param overload defaults to calling this one, so it fires on every level. */
    @Deprecated("Deprecated in Java")
    @Suppress("DEPRECATION")
    override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
      if (gatt !== this@OwGattClient.gatt) return
      handler.post {
        if (cleared || gatt !== this@OwGattClient.gatt) return@post
        completeOp()
      }
    }
  }

  // --- session phases -------------------------------------------------------

  /** Read the identity block, then decide whether the board needs unlocking. */
  private fun startInfoPhase(service: BluetoothGattService) {
    fun char(shortId: Int) = service.getCharacteristic(owCharUuid(shortId))

    // SerialRead stream must be live before the firmware write triggers the challenge.
    char(OW_CHAR_SERIAL_READ)?.let { enqueue(NotifyOp(it)) }
    char(OW_CHAR_FIRMWARE)?.let { enqueue(ReadOp(it)) }
    char(0xf318)?.let { enqueue(ReadOp(it)) }
    char(0xf301)?.let { enqueue(ReadOp(it)) }
    char(OW_CHAR_RIDE_MODE)?.let { enqueue(ReadOp(it)) }
    afterDrain = { evaluateLock() }
    drainQueue()
  }

  private fun evaluateLock() {
    if (owIsUnlocked(rideMode)) {
      startDataPhase()
      return
    }
    val firmware = firmwareRevision
    if (!owCanUnlockLocally(firmware)) {
      phase = OwPhase.Locked
      stateMessage = "Firmware ${firmware ?: "?"} needs a jumpstart: open the official Onewheel " +
        "app, connect to the board, wait for the ride mode, force-quit it, then reconnect here."
      emitState()
      return
    }
    if (unlockAttempted) {
      phase = OwPhase.Locked
      stateMessage = "Unlock handshake failed — reconnect and try again."
      emitState()
      return
    }
    unlockAttempted = true
    phase = OwPhase.Unlocking
    emitState()

    // Writing the firmware revision back onto its own characteristic makes the board stream the
    // 20-byte unlock challenge over the SerialRead notifications.
    challengeBuffer.reset()
    val svc = service ?: return fail("OneWheel service lost")
    val firmwareChar = svc.getCharacteristic(owCharUuid(OW_CHAR_FIRMWARE))
      ?: return fail("Firmware characteristic missing")
    val bytes = firmwareBytes ?: return fail("Firmware value missing")
    handshakeTimeout = Runnable {
      phase = OwPhase.Locked
      stateMessage = "Unlock challenge never arrived — reconnect and try again."
      emitState()
    }
    handler.postDelayed(handshakeTimeout!!, HANDSHAKE_TIMEOUT_MS)
    enqueue(WriteOp(firmwareChar, bytes))
    drainQueue()
  }

  /** Unlocked: subscribe to every live characteristic and read everything once. */
  private fun startDataPhase() {
    phase = OwPhase.Ready
    stateMessage = null
    emitState()
    val service = service ?: return

    val chars = service.characteristics.sortedBy { owShortId(it.uuid) ?: 0 }
    for (char in chars) {
      val shortId = owShortId(char.uuid) ?: continue
      if (shortId == OW_CHAR_SERIAL_READ) continue // already subscribed for the handshake
      val spec = owSpecFor(char.uuid)
      if (spec?.notify == true) enqueue(NotifyOp(char))
    }
    for (char in chars) {
      if (char.properties and BluetoothGattCharacteristic.PROPERTY_READ == 0) continue
      enqueue(ReadOp(char))
    }
    drainQueue()
    startKeepAlive()
  }

  /** OWCE KeepBoardAlive: re-write the firmware revision every 15s to hold the unlocked state. */
  private fun startKeepAlive() {
    val bytes = firmwareBytes ?: return
    val char = service?.getCharacteristic(owCharUuid(OW_CHAR_FIRMWARE)) ?: return
    val tick = Runnable {
      if (!cleared && phase == OwPhase.Ready) {
        enqueue(WriteOp(char, bytes))
        drainQueue()
        startKeepAlive()
      }
    }
    keepAlive = tick
    handler.postDelayed(tick, KEEP_ALIVE_MS)
  }

  // --- value handling -------------------------------------------------------

  private fun handleNotify(uuid: UUID, value: ByteArray) {
    if (uuid == owCharUuid(OW_CHAR_SERIAL_READ) && phase == OwPhase.Unlocking) {
      challengeBuffer.write(value)
      if (challengeBuffer.size() >= UNLOCK_CHALLENGE_BYTES) {
        handshakeTimeout?.let { handler.removeCallbacks(it) }
        val response = owBuildUnlockResponse(challengeBuffer.toByteArray())
        challengeBuffer.reset()
        val svc = service ?: return fail("OneWheel service lost")
        val writeChar = svc.getCharacteristic(owCharUuid(OW_CHAR_SERIAL_WRITE))
          ?: return fail("SerialWrite characteristic missing")
        val rideModeChar = svc.getCharacteristic(owCharUuid(OW_CHAR_RIDE_MODE))
          ?: return fail("Riding mode characteristic missing")
        enqueue(WriteOp(writeChar, response))
        enqueue(ReadOp(rideModeChar))
        afterDrain = { evaluateLock() }
        drainQueue()
      }
    }
    handleValue(uuid, value)
  }

  private fun beU16(value: ByteArray): Int? = value.takeIf { it.size >= 2 }
    ?.let { (it[0].toInt() and 0xFF shl 8) or (it[1].toInt() and 0xFF) }

  private fun handleValue(uuid: UUID, value: ByteArray) {
    val shortId = owShortId(uuid)
    val spec = owSpecFor(uuid)
    val display = spec?.parse?.invoke(value, firmwareRevision)?.display ?: owHex(value)
    when (shortId) {
      OW_CHAR_FIRMWARE -> {
        firmwareBytes = value
        firmwareRevision = beU16(value)
      }
      0xf318 -> hardwareRevision = beU16(value)
      0xf301 -> serial = beU16(value)
      OW_CHAR_RIDE_MODE -> rideMode = value.lastOrNull()?.toInt()?.and(0xFF)
      OW_CHAR_BATTERY -> batteryPercent = value.lastOrNull()?.toInt()?.and(0xFF)
      OW_CHAR_RPM -> speedKmh = beU16(value)?.let { owSpeedKmh(it) }
    }
    if (shortId in listOf(OW_CHAR_RIDE_MODE, OW_CHAR_BATTERY, OW_CHAR_RPM)) {
      emitState()
    }
    listener.onCharacteristic(
      mapOf(
        "uuid" to uuid.toString(),
        "shortId" to (shortId?.let { "f3%02x".format(it) } ?: uuid.toString()),
        "name" to (spec?.name ?: "Unknown"),
        "hex" to owHex(value),
        "display" to display,
        "updatedAt" to System.currentTimeMillis().toDouble(),
      ),
    )
  }

  // --- op queue -------------------------------------------------------------

  private fun enqueue(op: GattOp) {
    opQueue.addLast(op)
  }

  private fun drainQueue() {
    if (opInFlight != null) return
    val gatt = gatt ?: return
    val next = opQueue.removeFirstOrNull()
    if (next == null) {
      val hook = afterDrain
      afterDrain = null
      hook?.invoke()
      return
    }
    opInFlight = next
    val watchdog = Runnable {
      Log.w(TAG, "op timeout: ${next.label}")
      completeOp()
    }
    opWatchdog = watchdog
    handler.postDelayed(watchdog, OP_TIMEOUT_MS)
    val started = try {
      next.start(gatt)
    } catch (e: Exception) {
      Log.w(TAG, "op start threw: ${next.label}: ${e.message}")
      false
    }
    if (!started) {
      Log.w(TAG, "op start failed: ${next.label}")
      completeOp()
    }
  }

  private fun completeOp() {
    opWatchdog?.let { handler.removeCallbacks(it) }
    opWatchdog = null
    opInFlight = null
    drainQueue()
  }

  // --- state ----------------------------------------------------------------

  private fun fail(message: String) {
    phase = OwPhase.Error
    stateMessage = message
    emitState()
    clear()
  }

  private fun emitState() {
    listener.onState(
      mapOf(
        "phase" to phase.wire,
        "deviceId" to device.address,
        "message" to stateMessage,
        "firmwareRevision" to firmwareRevision,
        "hardwareRevision" to hardwareRevision,
        "serial" to serial,
        "rideMode" to rideMode,
        "speedKmh" to speedKmh,
        "batteryPercent" to batteryPercent,
      ),
    )
  }
}
