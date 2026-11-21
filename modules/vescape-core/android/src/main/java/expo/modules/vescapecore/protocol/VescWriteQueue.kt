package expo.modules.vescapecore.protocol

/**
 * @parity /modules/vescape-core/ios/protocol/VescWriteQueue.swift
 * @platform-diff Android's `writeCharacteristic` can refuse to start a write, so [retryInFlight]
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

    private var frame: Write? = null
    private var frameOffset = 0
    private var inFlightOffset = 0
    private var chunkLimit = DEFAULT_CHUNK_LIMIT

    @Synchronized
    fun setChunkLimit(bytes: Int) {
        chunkLimit = bytes.coerceAtLeast(DEFAULT_CHUNK_LIMIT)
    }

    @Synchronized
    fun enqueueNormal(bytes: ByteArray) {
        normal.addLast(bytes)
    }

    @Synchronized
    fun replaceRemoteInput(bytes: ByteArray, urgent: Boolean = false) {
        if (!urgent && pendingRemoteInput?.urgent == true) return
        pendingRemoteInput = RemoteInput(bytes, urgent)
    }

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

    @Synchronized
    fun completeInFlight(failed: Boolean = false): Write? {
        val completed = inFlight
        inFlight = null
        if (failed || frameOffset >= (frame?.bytes?.size ?: 0)) frame = null
        return completed
    }

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
        chunkLimit = DEFAULT_CHUNK_LIMIT
    }

    companion object {
        const val DEFAULT_CHUNK_LIMIT = 20
    }
}
