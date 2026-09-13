package expo.modules.vescapecore

import expo.modules.vescapecore.accessory.GroundClearance
import expo.modules.vescapecore.accessory.BoardGroundClearanceBinding
import expo.modules.vescapecore.accessory.GroundClearanceInput
import expo.modules.vescapecore.accessory.GroundClearanceRelease
import expo.modules.vescapecore.connection.BoardTransport
import expo.modules.vescapecore.protocol.BOARD_MOVE_INPUT_MAX
import expo.modules.vescapecore.protocol.BoardMoveGeneration
import expo.modules.vescapecore.protocol.REMOTE_TILT_CENTER
import expo.modules.vescapecore.protocol.buildBoardMoveCommand
import expo.modules.vescapecore.protocol.buildRemoteTiltCommand
import expo.modules.vescapecore.runtime.TestScheduler
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Who is allowed to write the Board's remote-input slot, and what happens at every handover.
 *
 * These are the ownership regressions #479 asks for. The failures they describe are all the same
 * shape: two of the three writers active at once, each repeating its own value on its own tick, so
 * the Board receives an alternating stream and does neither thing. On a ridden Board that is not a
 * glitch, it is a rider on the floor — which is why the interesting assertions here are about what
 * is *not* sent.
 *
 * @parity /modules/vescape-core/ios/RemoteInputArbiterTests.swift
 */
class RemoteInputArbiterTest {
    private val scheduler = TestScheduler()
    private val sent = mutableListOf<ByteArray>()
    private var transport: BoardTransport? = BoardTransport.Direct
    private var canMove = true

    private val tilt = RemoteTiltController(
        scheduler = scheduler,
        transport = { transport },
        send = { payload, _ -> sent.add(payload); true },
    )
    private val move = BoardMoveController(
        scheduler = scheduler,
        transport = { transport },
        canMove = { canMove },
        generation = { BoardMoveGeneration.Remote },
        send = { payload, _ -> sent.add(payload); true },
    )
    private var sensorBound = false
    private val arbiter = RemoteInputArbiter(
        tilt = tilt,
        move = move,
        nowMs = { scheduler.currentTimeMs },
        sensorBound = { sensorBound },
    )

    private fun tiltPacket(value: Int) = buildRemoteTiltCommand(BoardTransport.Direct, value)

    private fun movePacket(input: Int) =
        buildBoardMoveCommand(BoardTransport.Direct, BoardMoveGeneration.Remote, input)

    /** Drives the sensor at full strength for long enough that the slew limit is no longer the story. */
    private fun settleSensorAt(target: Int) {
        repeat(12) {
            arbiter.sensorDrive(target)
            scheduler.advance(100)
        }
        assertEquals(target, arbiter.sensorCommand)
    }

    @Test
    fun sensorRampsToItsTargetInsteadOfSteppingToIt() {
        // A pothole under the sensor produces a full-range swing in one sample. Handing that to the
        // firmware as a single step is the same angle error a snapped cancel would be.
        arbiter.sensorDrive(255)
        val first = arbiter.sensorCommand
        assertTrue("first command must leave neutral", first > REMOTE_TILT_CENTER)
        assertTrue("first command must not be the full swing", first < 255)

        settleSensorAt(255)
    }

    @Test
    fun sensorFollowsItsReadingsOnceRamped() {
        settleSensorAt(200)

        // Small changes inside the slew allowance land exactly, so steady tracking is not distorted.
        scheduler.advance(100)
        arbiter.sensorDrive(198)
        assertEquals(198, arbiter.sensorCommand)
    }

    @Test
    fun manualTiltIsRefusedWhileTheSensorIsDriving() {
        settleSensorAt(200)
        val before = sent.size

        assertFalse(arbiter.manualHold(40))
        assertFalse(arbiter.manualLock(40))
        assertFalse(arbiter.manualRelease(40, 1_000))
        assertEquals("a refused manual command writes nothing", before, sent.size)
        assertEquals(RemoteInputOwner.SENSOR, arbiter.owner)
    }

    @Test
    fun sensorIsRefusedWhileBoardMoveHoldsTheSlot() {
        assertTrue(arbiter.startMove(BOARD_MOVE_INPUT_MAX))
        sent.clear()

        assertFalse(arbiter.sensorDrive(255))
        assertEquals(RemoteInputOwner.MOVE, arbiter.owner)

        // Nothing but move packets reach the board while it is jogging.
        scheduler.advance(300)
        assertTrue(sent.isNotEmpty())
        assertTrue(sent.all { it.contentEquals(movePacket(BOARD_MOVE_INPUT_MAX)) })
    }

    @Test
    fun boardMoveIsNotOverwrittenByAPendingSensorDecay() {
        settleSensorAt(255)
        // The rider steps off: the binding releases and the smooth return starts.
        arbiter.sensorRelease()
        assertEquals(RemoteTiltPhase.Decaying, tilt.phase)

        // Board Move, requested while that return is still easing down.
        sent.clear()
        assertTrue(arbiter.startMove(-BOARD_MOVE_INPUT_MAX))
        assertEquals(RemoteInputOwner.MOVE, arbiter.owner)

        // One neutral tilt hands the slot back, and after it the board hears nothing but the move.
        assertArrayEquals(tiltPacket(REMOTE_TILT_CENTER), sent.first())
        scheduler.advance(600)
        val afterHandover = sent.drop(1)
        assertTrue(afterHandover.isNotEmpty())
        assertTrue(
            "a pending decay must not keep writing over Board Move",
            afterHandover.all { it.contentEquals(movePacket(-BOARD_MOVE_INPUT_MAX)) },
        )
    }

    @Test
    fun boardMoveIsRefusedWhileTheSensorIsCorrecting() {
        settleSensorAt(220)
        sent.clear()

        // A board asking for ground-clearance correction is a board being ridden, and jogging one is
        // not a request this app passes on.
        assertFalse(arbiter.startMove(BOARD_MOVE_INPUT_MAX))
        assertEquals(RemoteInputOwner.SENSOR, arbiter.owner)
        assertTrue(sent.none { it.contentEquals(movePacket(BOARD_MOVE_INPUT_MAX)) })
    }

    @Test
    fun sensorReleaseEasesOutOnceRatherThanRestartingEveryTick() {
        settleSensorAt(255)

        assertTrue(arbiter.sensorRelease())
        val total = tilt.decayProgress?.totalMs
        assertEquals(600L, total)

        // The Board Session calls this on every tick it has no valid reading. Only the first cancels;
        // a repeat would re-ease from a smaller value and the return would never arrive.
        scheduler.advance(200)
        assertFalse(arbiter.sensorRelease())
        assertEquals(total, tilt.decayProgress?.totalMs)

        scheduler.advance(400)
        assertEquals(RemoteTiltPhase.Idle, tilt.phase)
        assertEquals(RemoteInputOwner.NONE, arbiter.owner)
        assertArrayEquals(tiltPacket(REMOTE_TILT_CENTER), sent.last())
    }

    @Test
    fun aBindingArmingTakesBackALockedManualTilt() {
        assertTrue(arbiter.manualLock(255))
        assertEquals(RemoteInputOwner.MANUAL, arbiter.owner)

        // A lock never ends on its own, so without this the binding would wait for the slot forever.
        assertTrue(arbiter.releaseManual())
        assertEquals(RemoteTiltPhase.Decaying, tilt.phase)
        scheduler.advance(600)
        assertEquals(RemoteInputOwner.NONE, arbiter.owner)

        assertTrue(arbiter.sensorDrive(200))
        assertEquals(RemoteInputOwner.SENSOR, arbiter.owner)
    }

    @Test
    fun manualTiltKeepsItsSlotWhileNoSensorIsDriving() {
        assertTrue(arbiter.manualHold(200))
        assertEquals(RemoteInputOwner.MANUAL, arbiter.owner)
        assertTrue(arbiter.manualHold(210))
        assertArrayEquals(tiltPacket(200), sent.first())
    }

    @Test
    fun cancelReleasesWhoeverHeldTheSlot() {
        settleSensorAt(255)

        assertTrue(arbiter.cancelTilt())
        assertEquals(RemoteTiltPhase.Decaying, tilt.phase)
        // Cancel is not an off switch for the binding: a sensor still holding valid readings takes
        // the slot back on its next tick, ramped from where the cancel left it.
        assertEquals(REMOTE_TILT_CENTER, arbiter.sensorCommand)
        scheduler.advance(100)
        val eased = tilt.currentValue
        assertTrue("the cancel must have eased some of the tilt off", eased in 1 until 255)
        assertTrue(arbiter.sensorDrive(255))
        assertTrue("re-engaging must resume from the eased value, never step", arbiter.sensorCommand >= eased)
        assertNotEquals(255, arbiter.sensorCommand)
    }

    @Test
    fun aSensorReEngagingMidReleaseResumesFromTheStreamRatherThanNeutral() {
        settleSensorAt(255)
        // One bad reading releases; the reading after it is good again, which is an ordinary minute
        // of riding past a puddle, not an exotic case.
        assertTrue(arbiter.sensorRelease())
        scheduler.advance(200)
        val eased = tilt.currentValue
        assertTrue("the release must have eased some of the tilt off", eased in 1 until 255)

        sent.clear()
        assertTrue(arbiter.sensorDrive(255))
        scheduler.advance(100)
        // Resuming from neutral here would hand the firmware the whole unfinished decay as one step
        // — a ~100-count drop on a board with a rider on it, which is the surge a snapped cancel
        // would cause and the reason nothing in this class is allowed to step.
        assertTrue("re-engage must not step down to neutral", arbiter.sensorCommand >= eased)
        assertTrue(sent.isNotEmpty())
        assertTrue(
            "no packet may drop the commanded tilt back toward neutral",
            sent.none { it.contentEquals(tiltPacket(REMOTE_TILT_CENTER)) },
        )
    }

    @Test
    fun manualTiltIsRefusedWhileABindingIsBoundEvenWithTheSlotFree() {
        // Bound but not driving: parked, or between readings. The slot is genuinely free, and
        // without the bound check a manual *lock* taken here would never end on its own — and the
        // pad is read-only by then, so the rider has no Cancel to press.
        sensorBound = true
        assertEquals(RemoteInputOwner.NONE, arbiter.owner)

        assertFalse(arbiter.manualHold(200))
        assertFalse(arbiter.manualLock(200))
        assertFalse(arbiter.manualRelease(200, 1_000))
        assertTrue("a refused manual command writes nothing", sent.isEmpty())
        assertEquals(RemoteInputOwner.NONE, arbiter.owner)

        // The binding can still take the slot it was holding open.
        assertTrue(arbiter.sensorDrive(200))
        assertEquals(RemoteInputOwner.SENSOR, arbiter.owner)
    }

    @Test
    fun aBoundBindingKeepsReleasingAManualTiltItDidNotCatchWhenItArmed() {
        // A lock taken in the window before the pad learned it was read-only, or one whose
        // arming-time cancel failed on a transport that blinked.
        assertTrue(arbiter.manualLock(255))
        assertEquals(RemoteInputOwner.MANUAL, arbiter.owner)
        sensorBound = true

        val binding = BoardGroundClearanceBinding(
            remoteInput = arbiter,
            boundInput = { true },
            tiltInput = { GroundClearanceInput.Drive(1.0, 5.0) },
        )
        val board = BoardGroundClearanceBinding.BoardInput(commandsTrusted = true, telemetryFresh = true)

        // Already bound on the first tick, so there is no unbound→bound transition to catch it.
        binding.tick(board)
        assertEquals("manual-tilt", binding.state()["release"])
        assertEquals(RemoteTiltPhase.Decaying, tilt.phase)
        val total = tilt.decayProgress?.totalMs

        // Repeating the release must not restart the ease, or it would shrink toward zero forever.
        scheduler.advance(200)
        binding.tick(board)
        assertEquals(total, tilt.decayProgress?.totalMs)

        scheduler.advance(600)
        binding.tick(board)
        assertEquals("the binding takes the slot once the ease finishes", RemoteInputOwner.SENSOR, arbiter.owner)
        assertNull(binding.state()["release"])
    }

    @Test
    fun resetLeavesNothingStreamingOnEitherChannel() {
        settleSensorAt(255)
        arbiter.reset()

        assertEquals(RemoteInputOwner.NONE, arbiter.owner)
        assertArrayEquals(tiltPacket(REMOTE_TILT_CENTER), sent[sent.size - 2])
        assertArrayEquals(movePacket(0), sent.last())

        scheduler.advance(1_000)
        val afterReset = sent.size
        scheduler.advance(1_000)
        assertEquals("nothing repeats after a reset", afterReset, sent.size)
    }

    @Test
    fun aLostTransportEndsTheSensorStreamRatherThanHoldingItsLastValue() {
        settleSensorAt(255)
        transport = null

        // The repeat loop is the sole sender; with no transport it clears itself, and the arbiter's
        // derived owner follows the stream rather than remembering a claim it can no longer serve.
        scheduler.advance(100)
        assertEquals(RemoteTiltPhase.Idle, tilt.phase)
        assertEquals(RemoteInputOwner.NONE, arbiter.owner)
    }

    @Test
    fun correctionMapsOntoThePadsOwnScaleAndSaturates() {
        assertEquals(REMOTE_TILT_CENTER, GroundClearance.tiltCommand(0.0))
        assertEquals(255, GroundClearance.tiltCommand(1.0))
        assertEquals(1, GroundClearance.tiltCommand(-1.0))
        // Nothing upstream can produce these; the one place that decides what a board is told is not
        // where to find that out.
        assertEquals(255, GroundClearance.tiltCommand(4.0))
        assertEquals(1, GroundClearance.tiltCommand(-4.0))
        assertEquals(REMOTE_TILT_CENTER, GroundClearance.tiltCommand(Double.NaN))
    }

    @Test
    fun boardBindingOwnsTickCancellationAndBoardReasonPrecedence() {
        var sourceReads = 0
        val binding = BoardGroundClearanceBinding(
            remoteInput = arbiter,
            boundInput = { sourceReads += 1; true },
            tiltInput = { GroundClearanceInput.Drive(1.0, 5.0) },
        )
        fun schedule(tick: () -> Unit) =
            scheduler.postDelayed(BoardGroundClearanceBinding.TICK_MS, tick)

        binding.start(::schedule) {
            BoardGroundClearanceBinding.BoardInput(commandsTrusted = false, telemetryFresh = false)
        }
        scheduler.advance(BoardGroundClearanceBinding.TICK_MS)
        assertEquals("board trust wins over stale telemetry and a valid sensor", "board-untrusted", binding.state()["release"])
        assertEquals(RemoteInputOwner.NONE, arbiter.owner)

        binding.stop()
        val readsAfterStop = sourceReads
        binding.start(::schedule) {
            BoardGroundClearanceBinding.BoardInput(commandsTrusted = true, telemetryFresh = false)
        }
        scheduler.advance(BoardGroundClearanceBinding.TICK_MS)
        assertEquals("board-stale", binding.state()["release"])
        assertEquals(readsAfterStop + 1, sourceReads)

        binding.stop()
        binding.start(::schedule) {
            BoardGroundClearanceBinding.BoardInput(commandsTrusted = true, telemetryFresh = true)
        }
        scheduler.advance(BoardGroundClearanceBinding.TICK_MS * 2)
        assertEquals(RemoteInputOwner.SENSOR, arbiter.owner)
        binding.stop()
        assertEquals(REMOTE_TILT_CENTER, arbiter.sensorCommand)
        assertEquals(RemoteTiltPhase.Decaying, tilt.phase)
        val finalReads = sourceReads
        scheduler.advance(BoardGroundClearanceBinding.TICK_MS * 2)
        assertEquals("a stopped session cannot receive its old callback", finalReads, sourceReads)
    }
}
