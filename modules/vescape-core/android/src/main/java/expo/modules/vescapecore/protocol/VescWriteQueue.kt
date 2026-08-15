package expo.modules.vescapecore.protocol

/**
 * Serializes BLE writes while keeping transient remote input (tilt, Board Move) replaceable.
 *
 * Normal commands preserve FIFO ordering. Remote input has at most one pending
 * command: a newer value replaces an older one. Ordinary remote commands and
 * normal traffic alternate when both are pending; emergency neutral always
 * dispatches first once the current write completes.
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

    /** Start next write, or `null` while another write is active or queue is empty. */
    @Synchronized
    fun startNext(): Write? {
        if (inFlight != null) return null

        val remoteInput = pendingRemoteInput
        if (remoteInput != null && (remoteInput.urgent || normal.isEmpty() || preferRemoteInput)) {
            pendingRemoteInput = null
            preferRemoteInput = false
            return Write.RemoteInput(remoteInput.bytes).also { inFlight = it }
        }

        val next = normal.removeFirstOrNull() ?: return null
        preferRemoteInput = true
        return Write.Normal(next).also { inFlight = it }
    }

    /** Complete current write after its GATT callback. */
    @Synchronized
    fun completeInFlight(): Write? = inFlight.also { inFlight = null }

    /**
     * Put a write that Android refused to start back into the queue. A newer
     * remote input value wins over the refused one.
     */
    @Synchronized
    fun retryInFlight() {
        when (val write = inFlight) {
            is Write.Normal -> normal.addFirst(write.bytes)
            is Write.RemoteInput -> if (pendingRemoteInput == null) {
                pendingRemoteInput = RemoteInput(write.bytes, urgent = false)
            }
            null -> Unit
        }
        inFlight = null
    }

    @Synchronized
    fun clear() {
        normal.clear()
        pendingRemoteInput = null
        inFlight = null
        preferRemoteInput = false
    }
}
