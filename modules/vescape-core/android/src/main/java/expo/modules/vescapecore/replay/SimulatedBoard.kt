package expo.modules.vescapecore.replay

import expo.modules.vescapecore.protocol.COMM_BMS_GET_VALUES
import expo.modules.vescapecore.protocol.COMM_CUSTOM_APP_DATA
import expo.modules.vescapecore.protocol.COMM_FW_VERSION
import expo.modules.vescapecore.protocol.COMM_GET_CUSTOM_CONFIG
import expo.modules.vescapecore.protocol.COMM_GET_CUSTOM_CONFIG_XML
import expo.modules.vescapecore.protocol.COMM_GET_MCCONF
import expo.modules.vescapecore.protocol.COMM_SET_CUSTOM_CONFIG
import expo.modules.vescapecore.protocol.REFLOAT_GET_ALLDATA
import expo.modules.vescapecore.protocol.REFLOAT_GET_INFO
import expo.modules.vescapecore.protocol.REFLOAT_LIGHTS_CONTROL
import expo.modules.vescapecore.protocol.REFLOAT_LIGHTS_CONTROL_LEGACY
import expo.modules.vescapecore.protocol.SessionTransport
import expo.modules.vescapecore.protocol.VescGattListener
import expo.modules.vescapecore.protocol.VescPacketCodec
import expo.modules.vescapecore.reconnect.ReconnectBlePort
import expo.modules.vescapecore.reconnect.ReconnectScanMatch
import expo.modules.vescapecore.service.VESC_SESSION_TAG

import android.os.Handler
import android.os.Looper
import android.util.Log
import java.nio.ByteBuffer

/** Wall-clock tail after the last recorded event before a non-looping replay ends the session. */
private const val END_TAIL_MS = 250L

/** GATT status reported for a dropped link: the connection supervision timeout a real drop gives. */
private const val DROPPED_LINK_STATUS = 8

/**
 * Where a [SimulatedBoard] is in its recording.
 *
 * @parity /modules/vescape-core/ios/replay/SimulatedBoard.swift `ReplayPlaybackState`
 */
/**
 * @parity /modules/vescape-core/src/index.ts `DebugReplayState`
 */
internal data class ReplayPlaybackState(
    val recording: String,
    val positionMs: Long,
    val durationMs: Long,
    val paused: Boolean,
    val loop: Boolean,
    val linked: Boolean,
)

/**
 * The board a replay session talks to in place of the GATT client (ADR 0048). It plays the
 * recording's timeline at its recorded offsets and answers the app's requests from the recording's
 * [ReplyBook] and its own state, so every session feature runs exactly as on a ride.
 *
 * It is also the session's [ReconnectBlePort]: there is no radio to scan, so a reconnect finds the
 * board at once and the link resumes where playback stopped.
 *
 * Confined to [handler]'s thread; public entry points run inline there and hop onto it from
 * anywhere else.
 *
 * @parity /modules/vescape-core/ios/replay/SimulatedBoard.swift
 */
internal class SimulatedBoard(
    private val handler: Handler,
    private val recording: ReplayRecording,
    /** Recorded offset playback starts at; the controller prefills everything before it. */
    warmupMs: Long,
    loop: Boolean,
    private val listener: VescGattListener,
    private val dispatchListener: ((() -> Unit) -> Unit),
    private val onLocation: (ReplayLocation) -> Unit,
    /** The recording ran out without loop: the board powered off on purpose. */
    private val onEnded: () -> Unit,
) : SessionTransport, ReconnectBlePort {
    private val timeline = recording.timeline
    private val warmupEnd = timeline.indexOfFirst { it.t >= warmupMs }.let { if (it < 0) timeline.size else it }
    private var cursor = warmupEnd
    @Volatile
    private var positionMs = warmupMs

    /** Wall time of recorded offset 0 while the timeline runs. */
    @Volatile
    private var originMs = 0L
    private var pending: Runnable? = null

    @Volatile
    private var linked = false

    /** Bumped on every unlink; work queued for an earlier link drops itself. */
    @Volatile
    private var link = 0

    @Volatile
    private var paused = false

    @Volatile
    private var looping = loop

    /** Config the board holds beyond the recording: `[sig, bytes]` per `confInd`. */
    private val heldConfig = mutableMapOf<Int, ByteArray>()
    private var lightsBits = 0
    private var lastTelemetry: ByteArray? = null
    private var lastBms: ByteArray? = null

    init {
        // The board was already holding whatever the warmup span wrote and last said.
        for (event in warmup) {
            when (event) {
                is ReplayEvent.ConfigWrite -> holdConfig(event.payload)
                is ReplayEvent.Frame -> remember(event.payload)
                is ReplayEvent.Fix -> Unit
            }
        }
    }

    /** The warmup span, for the controller to prefill display state from. */
    val warmup: List<ReplayEvent> get() = timeline.subList(0, warmupEnd)

    fun state(): ReplayPlaybackState = ReplayPlaybackState(
        recording = recording.name,
        positionMs = if (linked && !paused) System.currentTimeMillis() - originMs else positionMs,
        durationMs = recording.durationMs,
        paused = paused,
        loop = looping,
        linked = linked,
    )

    // region SessionTransport

    /**
     * Like a GATT client, a connect drops whatever link is up first: recovery restarts the
     * transport on a link that is still up when telemetry stalls.
     */
    override fun connect(deviceId: String) {
        onHandler {
            unlink()
            onLink { establish() }
        }
    }

    override fun sendPayload(payload: ByteArray): Boolean {
        if (!linked) return false
        val request = ReplayRecording.unwrapCan(payload) ?: return true
        onLink { answer(request)?.let(::reply) }
        return true
    }

    /** Remote Tilt and Board Move: the board takes them and says nothing back. */
    override fun sendRemoteInput(payload: ByteArray, urgent: Boolean): Boolean = linked

    override fun clear(markIntentional: Boolean) {
        onHandler { unlink() }
    }

    // endregion

    // region ReconnectBlePort

    override fun hasScanner(): Boolean = true

    override fun startScan(
        targetId: String,
        onFound: (ReconnectScanMatch) -> Unit,
        onFailed: (errorCode: Int) -> Unit,
    ): Boolean {
        handler.post { onFound(ReconnectScanMatch(targetId, rssi = null)) }
        return true
    }

    override fun stopScan() = Unit

    // endregion

    // region Controls

    fun setPaused(value: Boolean) {
        onHandler {
            if (paused == value) return@onHandler
            if (value) {
                freezeTimeline()
                paused = true
            } else {
                paused = false
                if (linked) resumeTimeline()
            }
        }
    }

    /** Read when the end comes, so it also decides an end already scheduled. */
    fun setLoop(value: Boolean) {
        looping = value
    }

    /** Lose the link the way a board out of range does; the session's reconnect brings it back. */
    fun dropLink() {
        onHandler {
            if (!linked) return@onHandler
            unlink()
            Log.d(VESC_SESSION_TAG, "replay link dropped recording=${recording.name} positionMs=$positionMs")
            dispatch { onGattDisconnected(DROPPED_LINK_STATUS, intentional = false) }
        }
    }

    // endregion

    private fun establish() {
        linked = true
        Log.d(VESC_SESSION_TAG, "replay connect recording=${recording.name} positionMs=$positionMs")
        dispatch { onGattConnected() }
        dispatch { onGattSubscribing() }
        dispatch { onGattReady() }
        resumeTimeline()
        // Wall time of recorded t=0; `bun run preview` starts the wrist's replay from it.
        Log.d(VESC_SESSION_TAG, "replay playback started recording=${recording.name} wallMs=$originMs")
    }

    private fun unlink() {
        link += 1
        if (!linked) return
        if (!paused) freezeTimeline()
        linked = false
    }

    private fun onHandler(block: () -> Unit) {
        if (Looper.myLooper() == handler.looper) block() else handler.post(block)
    }

    /** Runs [block] on [handler] unless the link it was queued on has gone since. */
    private fun onLink(block: () -> Unit) {
        val queuedOn = link
        handler.post { if (link == queuedOn) block() }
    }

    private fun dispatch(call: VescGattListener.() -> Unit) {
        val queuedOn = link
        dispatchListener { if (link == queuedOn) listener.call() }
    }

    private fun freezeTimeline() {
        if (linked && !paused) positionMs = System.currentTimeMillis() - originMs
        pending?.let(handler::removeCallbacks)
        pending = null
    }

    private fun resumeTimeline() {
        originMs = System.currentTimeMillis() - positionMs
        if (!paused) scheduleNext()
    }

    /** Only the next event is ever queued, so an hour-long recording never floods the handler. */
    private fun scheduleNext() {
        if (cursor < timeline.size) {
            val event = timeline[cursor]
            postAt(event.t) {
                cursor += 1
                play(event)
                scheduleNext()
            }
            return
        }
        postAt(recording.durationMs + END_TAIL_MS) {
            if (looping) {
                Log.d(VESC_SESSION_TAG, "replay looped recording=${recording.name}")
                cursor = 0
                positionMs = 0L
                resumeTimeline()
            } else {
                Log.d(VESC_SESSION_TAG, "replay finished recording=${recording.name}")
                unlink()
                onEnded()
            }
        }
    }

    private fun postAt(recordedT: Long, block: () -> Unit) {
        val runnable = Runnable { pending = null; block() }
        pending = runnable
        handler.postDelayed(runnable, (originMs + recordedT - System.currentTimeMillis()).coerceAtLeast(0L))
    }

    private fun play(event: ReplayEvent) {
        when (event) {
            is ReplayEvent.Frame -> {
                remember(event.payload)
                reply(event.payload)
            }
            is ReplayEvent.Fix -> onLocation(event.fix)
            is ReplayEvent.ConfigWrite -> holdConfig(event.payload)
        }
    }

    private fun remember(payload: ByteArray) {
        when {
            ReplayRecording.refloatCommand(payload) == REFLOAT_GET_ALLDATA -> lastTelemetry = payload
            (payload[0].toInt() and 0xff) == COMM_BMS_GET_VALUES -> lastBms = payload
        }
    }

    private fun reply(payload: ByteArray) {
        val frame = VescPacketCodec.encode(payload)
        dispatch { onGattFrameChunk(frame) }
    }

    /** The board's reply to [request], or `null` where a real board would say nothing it knows. */
    private fun answer(request: ByteArray): ByteArray? {
        val book = recording.replies
        return when (request[0].toInt() and 0xff) {
            COMM_FW_VERSION -> book.firmware
            COMM_GET_MCCONF -> book.motorConfig
            // Polls are answered by the timeline; a paused board repeats what it last said.
            COMM_BMS_GET_VALUES -> if (paused) lastBms else null
            COMM_GET_CUSTOM_CONFIG_XML -> configXml(request)
            COMM_GET_CUSTOM_CONFIG -> config(request.getOrNull(1)?.toInt()?.and(0xff) ?: return null)
            COMM_SET_CUSTOM_CONFIG -> holdConfig(request)?.let { confInd ->
                byteArrayOf(COMM_SET_CUSTOM_CONFIG.toByte(), confInd.toByte())
            }
            COMM_CUSTOM_APP_DATA -> when (val command = ReplayRecording.refloatCommand(request)) {
                REFLOAT_GET_INFO -> book.refloatInfo
                REFLOAT_GET_ALLDATA -> if (paused) lastTelemetry else null
                REFLOAT_LIGHTS_CONTROL, REFLOAT_LIGHTS_CONTROL_LEGACY -> lights(command, request)
                else -> null
            }
            else -> null
        }
    }

    /** `[92, confInd, len:i32, offset:i32]` → `[92, confInd, total:i32, offset:i32, bytes]`. */
    private fun configXml(request: ByteArray): ByteArray? {
        if (request.size < 10) return null
        val confInd = request[1].toInt() and 0xff
        val xml = recording.replies.configXml[confInd] ?: return null
        val wanted = ByteBuffer.wrap(request, 2, 8)
        val length = wanted.int
        val offset = wanted.int
        if (offset < 0 || offset >= xml.size || length <= 0) return null
        val slice = xml.copyOfRange(offset, offset + minOf(xml.size - offset, length))
        return ByteBuffer.allocate(10 + slice.size)
            .put(COMM_GET_CUSTOM_CONFIG_XML.toByte())
            .put(confInd.toByte())
            .putInt(xml.size)
            .putInt(offset)
            .put(slice)
            .array()
    }

    /** What the board holds: its own last write, else the recording's snapshot as of now. */
    private fun config(confInd: Int): ByteArray? {
        heldConfig[confInd]?.let { held ->
            return byteArrayOf(COMM_GET_CUSTOM_CONFIG.toByte(), confInd.toByte()) + held
        }
        val snapshots = recording.replies.configSnapshots[confInd] ?: return null
        val now = state().positionMs
        return snapshots.lastOrNull { it.t <= now }?.payload ?: snapshots.firstOrNull()?.payload
    }

    /** Holds a `[95, confInd, sig, bytes]` write; returns its `confInd`. */
    private fun holdConfig(write: ByteArray): Int? {
        if (write.size < 6) return null
        val confInd = write[1].toInt() and 0xff
        heldConfig[confInd] = write.copyOfRange(2, write.size)
        return confInd
    }

    /** Applies the masked value bits and echoes the switch state under the request's command id. */
    private fun lights(command: Int, request: ByteArray): ByteArray? {
        if (request.size < 2) return null
        val mask = request[request.size - 2].toInt() and 0xff
        val value = request[request.size - 1].toInt() and 0xff
        lightsBits = (lightsBits and mask.inv()) or (value and mask)
        return byteArrayOf(
            COMM_CUSTOM_APP_DATA.toByte(),
            request[1],
            command.toByte(),
            lightsBits.toByte(),
        )
    }
}
