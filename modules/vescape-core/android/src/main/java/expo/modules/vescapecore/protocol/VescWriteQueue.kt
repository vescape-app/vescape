package expo.modules.vescapecore.protocol

/**
 * Serializes BLE writes while keeping transient remote input (tilt, Board Move) replaceable.
 *
 * Normal commands preserve FIFO ordering. Remote input has at most one pending
 * command: a newer value replaces an older one. Ordinary remote commands and
 * normal traffic alternate when both are pending; emergency neutral always
 * dispatches first once the current write completes.
 *
 * A frame larger than [chunkLimit] goes out as consecutive chunks. Some BLE modules hang on
 * the GATT long write the OS would otherwise use (#620). No other write runs between chunks of one
 * frame: extra bytes mid-frame corrupt the VESC byte stream. So an urgent neutral waits for the
 * frame in flight to finish, at most one frame of chunks (about 14 writes for a 280-byte tune
 * frame at MTU 23).
 *
 * @parity /modules/vescape-core/ios/protocol/VescWriteQueue.swift
 */
internal class VescWriteQueue {
    sealed interface Write {
        val bytes: ByteArray

        data class Normal(override val bytes: ByteArray) : Write
        data class RemoteInput(override val bytes: ByteArray) : Write
    }

    private val normal = ArrayDeque<ByteArray>()
    private data class RemoteInput(val bytes: ByteArray, val urgent: Boolean)

    private var pendingRemoteInput: RemoteInput? = null
    private var inFlight: Write? = null
    private var preferRemoteInput = false

    /** Frame whose chunks are being sent, and the offset of its next unsent byte. */
    private var frame: Write? = null
    private var frameOffset = 0
    private var inFlightOffset = 0
    private var chunkLimit = DEFAULT_CHUNK_LIMIT

    /** Largest single write the link accepts (ATT MTU - 3). Applies from the next chunk on. */
    @Synchronized
    fun setChunkLimit(bytes: Int) {
        chunkLimit = bytes.coerceAtLeast(DEFAULT_CHUNK_LIMIT)
    }

    @Synchronized
    fun enqueueNormal(bytes: ByteArray) {
        normal.addLast(bytes)
    }

    /**
     * Replace any unsent remote input with [bytes].
     *
     * An unsent urgent write survives: it is a neutral/stop, and Remote Tilt and Board Move share
     * this one slot, so a routine tick from the other feature must not swallow a stop that has not
     * reached the board yet. A newer urgent write still replaces an older one.
     */
    @Synchronized
    fun replaceRemoteInput(bytes: ByteArray, urgent: Boolean = false) {
        if (!urgent && pendingRemoteInput?.urgent == true) return
        pendingRemoteInput = RemoteInput(bytes, urgent)
    }

    /**
     * Start next chunk, or `null` while another write is active or the queue is empty. The rest of
     * a partly sent frame always goes before any other write.
     */
    @Synchronized
    fun startNext(): Write? {
        if (inFlight != null) return null
        val current = frame ?: nextFrame() ?: return null
        val end = minOf(frameOffset + chunkLimit, current.bytes.size)
        val bytes = if (frameOffset == 0 && end == current.bytes.size) {
            current.bytes
        } else {
            current.bytes.copyOfRange(frameOffset, end)
        }
        inFlightOffset = frameOffset
        frameOffset = end
        val write = when (current) {
            is Write.Normal -> Write.Normal(bytes)
            is Write.RemoteInput -> Write.RemoteInput(bytes)
        }
        return write.also { inFlight = it }
    }

    private fun nextFrame(): Write? {
        val remoteInput = pendingRemoteInput
        val next = if (remoteInput != null && (remoteInput.urgent || normal.isEmpty() || preferRemoteInput)) {
            pendingRemoteInput = null
            preferRemoteInput = false
            Write.RemoteInput(remoteInput.bytes)
        } else {
            val bytes = normal.removeFirstOrNull() ?: return null
            preferRemoteInput = true
            Write.Normal(bytes)
        }
        frame = next
        frameOffset = 0
        return next
    }

    /** Complete current chunk after its GATT callback. */
    @Synchronized
    fun completeInFlight(): Write? {
        val completed = inFlight
        inFlight = null
        if (frameOffset >= (frame?.bytes?.size ?: 0)) frame = null
        return completed
    }

    /**
     * Put a chunk that Android refused to start back into the queue. A partly sent frame resumes
     * from the refused chunk. A frame with nothing sent yet goes back whole, and a newer remote
     * input value wins over a refused one.
     */
    @Synchronized
    fun retryInFlight() {
        if (inFlight == null) return
        inFlight = null
        if (inFlightOffset > 0) {
            frameOffset = inFlightOffset
            return
        }
        when (val refused = frame) {
            is Write.Normal -> normal.addFirst(refused.bytes)
            is Write.RemoteInput -> if (pendingRemoteInput == null) {
                pendingRemoteInput = RemoteInput(refused.bytes, urgent = false)
            }
            null -> Unit
        }
        frame = null
    }

    @Synchronized
    fun clear() {
        normal.clear()
        pendingRemoteInput = null
        inFlight = null
        preferRemoteInput = false
        frame = null
        frameOffset = 0
        inFlightOffset = 0
    }

    companion object {
        /** Payload of one write at the default ATT MTU of 23. */
        const val DEFAULT_CHUNK_LIMIT = 20
    }
}
