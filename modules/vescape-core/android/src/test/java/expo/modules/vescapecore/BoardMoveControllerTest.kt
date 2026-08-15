package expo.modules.vescapecore

import expo.modules.vescapecore.connection.BoardTransport
import expo.modules.vescapecore.protocol.BoardMoveGeneration
import expo.modules.vescapecore.protocol.buildBoardMoveCommand
import expo.modules.vescapecore.runtime.TestScheduler
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BoardMoveControllerTest {
    private val scheduler = TestScheduler()
    private val sent = mutableListOf<ByteArray>()
    private val urgent = mutableListOf<Boolean>()
    private var transport: BoardTransport? = BoardTransport.Direct
    private var canMove = true
    private var generation = BoardMoveGeneration.Remote

    private fun controller() =
        BoardMoveController(
            scheduler = scheduler,
            transport = { transport },
            canMove = { canMove },
            generation = { generation },
            send = { payload, isUrgent ->
                sent.add(payload)
                urgent.add(isUrgent)
                true
            },
        )

    private fun move(input: Int) = buildBoardMoveCommand(BoardTransport.Direct, generation, input)

    @Test
    fun holdSendsImmediatelyThenRepeatsUntilStopped() {
        val controller = controller()

        assertTrue(controller.hold(25))
        assertArrayEquals(move(25), sent.single())

        scheduler.advance(250)
        assertEquals(3, sent.size)
        assertTrue(sent.drop(1).all { it.contentEquals(move(25)) })

        assertTrue(controller.stop())
        assertArrayEquals(move(0), sent.last())
        assertTrue(urgent.last())
        assertNull(controller.currentInput)

        // The repeat loop is cancelled, not merely idle.
        val afterStop = sent.size
        scheduler.advance(1_000)
        assertEquals(afterStop, sent.size)
    }

    @Test
    fun reversingMidHoldSwapsTheStreamWithoutAnExtraWrite() {
        val controller = controller()
        controller.hold(25)
        scheduler.advance(100)
        assertEquals(2, sent.size)

        assertTrue(controller.hold(-25))
        assertEquals(2, sent.size)

        scheduler.advance(100)
        assertArrayEquals(move(-25), sent.last())
    }

    @Test
    fun holdingZeroStops() {
        val controller = controller()
        controller.hold(25)
        sent.clear()

        assertTrue(controller.hold(0))
        assertArrayEquals(move(0), sent.single())
        assertFalse(controller.isMoving)
    }

    @Test
    fun holdIsRefusedWithoutATransport() {
        transport = null

        assertFalse(controller().hold(25))
        assertTrue(sent.isEmpty())
    }

    @Test
    fun losingTheTransportMidHoldEndsTheStream() {
        val controller = controller()
        controller.hold(25)
        transport = null

        scheduler.advance(100)
        assertEquals(1, sent.size)
        assertFalse(controller.isMoving)
        assertEquals(0, scheduler.pendingCount)
    }

    @Test
    fun holdIsRefusedWithoutATrustedLink() {
        canMove = false

        assertFalse(controller().hold(25))
        assertTrue(sent.isEmpty())
    }

    @Test
    fun losingLinkTrustMidHoldStopsWithANeutral() {
        val controller = controller()
        controller.hold(25)
        canMove = false

        scheduler.advance(100)
        assertArrayEquals(move(0), sent.last())
        assertTrue(urgent.last())
        assertFalse(controller.isMoving)
        assertEquals(0, scheduler.pendingCount)
    }

    @Test
    fun rcMoveBoardsGetTheOlderPayload() {
        generation = BoardMoveGeneration.RcMove
        val controller = controller()

        controller.hold(127)
        // [CUSTOM_APP_DATA, magic, RC_MOVE, direction, current, time, current + time]
        assertArrayEquals(byteArrayOf(36, 101, 7, 1, 60, 1, 61), sent.single())

        controller.stop()
        assertArrayEquals(byteArrayOf(36, 101, 7, 1, 0, 1, 1), sent.last())
    }
}
