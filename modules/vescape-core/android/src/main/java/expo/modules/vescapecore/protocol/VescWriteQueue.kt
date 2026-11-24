package expo.modules.vescapecore.protocol

/**
 * @parity /modules/vescape-core/ios/protocol/VescWriteQueue.swift
 * @platform-diff Android's `writeCharacteristic` can refuse to start a write, so [retryInFlight]
 * puts it back; CoreBluetooth cannot refuse, and the iOS queue has no retry.
 */
internal class VescWriteQueue {
    sealed interface Write {
        val bytes: ByteArray

        data class Normal(override val bytes: ByteArray) : Write
        data class RemoteInput(override val bytes: ByteArray) : Write
    }

    private data class NormalEntry(val bytes: ByteArray, val tag: String? = null)
    private val normal = ArrayDeque<NormalEntry>()
    private data class RemoteInput(val bytes: ByteArray, val urgent: Boolean)

    private var pendingRemoteInput: RemoteInput? = null
    private var inFlight: Write? = null
    private var preferRemoteInput = false

    private var frame: Write? = null
    private var frameTag: String? = null
    private var frameOffset = 0
    private var inFlightOffset = 0
    private var chunkLimit = DEFAULT_CHUNK_LIMIT

    @Synchronized
    fun setChunkLimit(bytes: Int) {
        chunkLimit = bytes.coerceAtLeast(DEFAULT_CHUNK_LIMIT)
    }

    @Synchronized
    fun enqueueNormal(bytes: ByteArray, tag: String? = null) {
        normal.addLast(NormalEntry(bytes, tag))
    }

    @Synchronized
    fun dropNormal(tag: String): Int {
        var dropped = 0
        val iterator = normal.iterator()
        while (iterator.hasNext()) {
            if (iterator.next().tag == tag) {
                iterator.remove()
                dropped++
            }
        }
        if (frameTag == tag) {
            frame = null
            frameTag = null
            frameOffset = 0
            inFlightOffset = 0
            dropped++
        }
        return dropped
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
            frameTag = null
            Write.RemoteInput(remoteInput.bytes)
        } else {
            val entry = normal.removeFirstOrNull() ?: return null
            preferRemoteInput = true
            frameTag = entry.tag
            Write.Normal(entry.bytes)
        }
        frame = next
        frameOffset = 0
        return next
    }

    @Synchronized
    fun completeInFlight(failed: Boolean = false): Write? {
        val completed = inFlight
        inFlight = null
        if (failed || frameOffset >= (frame?.bytes?.size ?: 0)) {
            frame = null
            frameTag = null
        }
        return completed
    }

    @Synchronized
    fun retryInFlight() {
        if (inFlight == null) return
        inFlight = null
        val refused = frame ?: return
        if (inFlightOffset > 0) {
            frameOffset = inFlightOffset
            return
        }
        when (refused) {
            is Write.Normal -> normal.addFirst(NormalEntry(refused.bytes, frameTag))
            is Write.RemoteInput -> if (pendingRemoteInput == null) {
                pendingRemoteInput = RemoteInput(refused.bytes, urgent = false)
            }
        }
        frame = null
        frameTag = null
    }

    @Synchronized
    fun clear() {
        normal.clear()
        pendingRemoteInput = null
        inFlight = null
        preferRemoteInput = false
        frame = null
        frameTag = null
        frameOffset = 0
        inFlightOffset = 0
        chunkLimit = DEFAULT_CHUNK_LIMIT
    }

    companion object {
        const val DEFAULT_CHUNK_LIMIT = 20
    }
}
