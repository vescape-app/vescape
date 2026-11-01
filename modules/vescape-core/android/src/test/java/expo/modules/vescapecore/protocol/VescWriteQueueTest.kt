package expo.modules.vescapecore.protocol

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VescWriteQueueTest {
    @Test
    fun neutralRemoteInputReplacesStaleTiltAndPreemptsNormalTraffic() {
        val queue = VescWriteQueue()
        val inFlightPoll = byteArrayOf(1)
        val queuedPoll = byteArrayOf(2)
        val staleTilt = byteArrayOf(3)
        val neutralTilt = byteArrayOf(4)

        queue.enqueueNormal(inFlightPoll)
        assertArrayEquals(inFlightPoll, queue.startNext()!!.bytes)
        queue.enqueueNormal(queuedPoll)
        queue.replaceRemoteInput(staleTilt)
        queue.replaceRemoteInput(neutralTilt, urgent = true)

        queue.completeInFlight()
        val next = queue.startNext()
        assertEquals(VescWriteQueue.Write.RemoteInput::class, next!!::class)
        assertArrayEquals(neutralTilt, next.bytes)

        queue.completeInFlight()
        assertArrayEquals(queuedPoll, queue.startNext()!!.bytes)
    }

    @Test
    fun onlyOneRemoteInputWriteCanWaitBehindInFlightWrite() {
        val queue = VescWriteQueue()
        val first = byteArrayOf(1)
        val latest = byteArrayOf(2)

        queue.replaceRemoteInput(first)
        assertArrayEquals(first, queue.startNext()!!.bytes)
        queue.replaceRemoteInput(latest)
        assertNull(queue.startNext())

        queue.completeInFlight()
        assertArrayEquals(latest, queue.startNext()!!.bytes)
        queue.completeInFlight()
        assertNull(queue.startNext())
    }

    @Test
    fun ordinaryRemoteInputAndNormalTrafficAlternate() {
        val queue = VescWriteQueue()
        val firstTilt = byteArrayOf(1)
        val poll = byteArrayOf(2)
        val nextTilt = byteArrayOf(3)

        queue.replaceRemoteInput(firstTilt)
        assertArrayEquals(firstTilt, queue.startNext()!!.bytes)
        queue.completeInFlight()
        queue.enqueueNormal(poll)
        queue.replaceRemoteInput(nextTilt)

        assertArrayEquals(poll, queue.startNext()!!.bytes)
        queue.completeInFlight()
        assertArrayEquals(nextTilt, queue.startNext()!!.bytes)
    }

    @Test
    fun urgentNeutralTiltPreemptsNormalTraffic() {
        val queue = VescWriteQueue()
        val heldTilt = byteArrayOf(1)
        val poll = byteArrayOf(2)
        val neutralTilt = byteArrayOf(3)

        queue.replaceRemoteInput(heldTilt)
        assertArrayEquals(heldTilt, queue.startNext()!!.bytes)
        queue.completeInFlight()
        queue.enqueueNormal(poll)
        queue.replaceRemoteInput(neutralTilt, urgent = true)

        assertArrayEquals(neutralTilt, queue.startNext()!!.bytes)
    }

    @Test
    fun routineRemoteInputNeverSwallowsAnUnsentUrgentStop() {
        val queue = VescWriteQueue()
        val poll = byteArrayOf(1)
        val neutral = byteArrayOf(2)
        val otherFeatureTick = byteArrayOf(3)
        val newerNeutral = byteArrayOf(4)

        queue.enqueueNormal(poll)
        assertArrayEquals(poll, queue.startNext()!!.bytes)
        queue.replaceRemoteInput(neutral, urgent = true)
        // Remote Tilt and Board Move share this slot: a routine tick must not drop a pending stop.
        queue.replaceRemoteInput(otherFeatureTick)

        queue.completeInFlight()
        assertArrayEquals(neutral, queue.startNext()!!.bytes)

        // A newer stop still wins over an older one.
        queue.completeInFlight()
        queue.replaceRemoteInput(neutral, urgent = true)
        queue.replaceRemoteInput(newerNeutral, urgent = true)
        assertArrayEquals(newerNeutral, queue.startNext()!!.bytes)
    }

    @Test
    fun refusedRemoteInputWriteNeverOverwritesNewerTilt() {
        val queue = VescWriteQueue()
        val refused = byteArrayOf(1)
        val latest = byteArrayOf(2)

        queue.replaceRemoteInput(refused)
        assertArrayEquals(refused, queue.startNext()!!.bytes)
        queue.replaceRemoteInput(latest)
        queue.retryInFlight()

        assertArrayEquals(latest, queue.startNext()!!.bytes)
    }

    private fun frame(size: Int) = ByteArray(size) { it.toByte() }

    /** Drain every remaining write, completing each one, and return their bytes in order. */
    private fun drain(queue: VescWriteQueue): List<ByteArray> = buildList {
        while (true) {
            val write = queue.startNext() ?: break
            add(write.bytes)
            queue.completeInFlight()
        }
    }

    @Test
    fun largeFrameGoesOutAsOrderedChunksWithinTheLimit() {
        val queue = VescWriteQueue()
        val tuneFrame = frame(272)

        queue.enqueueNormal(tuneFrame)
        val writes = drain(queue)

        assertEquals(List(13) { 20 } + 12, writes.map { it.size })
        assertArrayEquals(tuneFrame, writes.reduce { acc, chunk -> acc + chunk })
    }

    @Test
    fun frameWithinTheLimitGoesOutAsOneWrite() {
        val queue = VescWriteQueue()
        val tuneFrame = frame(272)
        queue.setChunkLimit(514)

        queue.enqueueNormal(tuneFrame)

        assertArrayEquals(tuneFrame, drain(queue).single())
    }

    @Test
    fun noWriteRunsBetweenChunksOfOneFrame() {
        val queue = VescWriteQueue()
        val tuneFrame = frame(45)
        val poll = byteArrayOf(-1)
        val neutral = byteArrayOf(-2)

        queue.enqueueNormal(tuneFrame)
        queue.startNext()
        queue.enqueueNormal(poll)
        queue.replaceRemoteInput(neutral, urgent = true)
        queue.completeInFlight()

        val rest = drain(queue)

        assertEquals(listOf(20, 5), rest.take(2).map { it.size })
        // The stop still goes before later normal traffic, just after the frame in flight.
        assertArrayEquals(neutral, rest[2])
        assertArrayEquals(poll, rest[3])
    }

    @Test
    fun refusedChunkMidFrameIsRetriedWithItsOwnBytes() {
        val queue = VescWriteQueue()
        val tuneFrame = frame(50)

        queue.enqueueNormal(tuneFrame)
        queue.startNext()
        queue.completeInFlight()
        val refused = queue.startNext()!!.bytes
        queue.retryInFlight()

        val retried = queue.startNext()!!.bytes
        assertArrayEquals(refused, retried)
        queue.completeInFlight()
        assertArrayEquals(tuneFrame.copyOfRange(40, 50), drain(queue).single())
    }

    @Test
    fun refusedFirstChunkPutsTheWholeFrameBack() {
        val queue = VescWriteQueue()
        val tuneFrame = frame(50)

        queue.enqueueNormal(tuneFrame)
        queue.startNext()
        queue.retryInFlight()

        assertArrayEquals(tuneFrame, drain(queue).reduce { acc, chunk -> acc + chunk })
    }

    @Test
    fun failedChunkDropsTheRestOfItsFrame() {
        val queue = VescWriteQueue()
        val poll = byteArrayOf(-1)

        queue.enqueueNormal(frame(50))
        queue.enqueueNormal(poll)
        queue.startNext()
        queue.completeInFlight(failed = true)

        assertArrayEquals(poll, drain(queue).single())
    }

    @Test
    fun clearDropsAPartlySentFrame() {
        val queue = VescWriteQueue()

        queue.enqueueNormal(frame(50))
        queue.startNext()
        queue.clear()

        assertNull(queue.startNext())
    }
}
