package app.vescape.wear

import expo.modules.vescapecore.watch.WatchMotionFacts
import expo.modules.vescapecore.watch.WatchMotionClock
import expo.modules.vescapecore.watch.WatchMapPosition
import expo.modules.vescapecore.watch.WatchFrame as PhoneFrame
import expo.modules.vescapecore.watch.WatchFrameBuilder
import org.junit.Assert.*
import org.junit.Test

/** @parity /modules/vescape-core/ios/watch/WatchMotionFactsTests.swift */
class WatchMotionFactsTest {
    private val epoch = 1793100000000.0
    private fun facts(sent: Double, source: Double = epoch + 1, fix: Double = epoch + 11) = WatchMotionFacts(source, fix, sent, 20.0, 30.0, 3.0)
    @Test fun `facts survive actual float32 wire`() {
        val input = facts(epoch + 999)
        val frame = PhoneFrame(20.0, null, null, null, null, false, motionFacts = input)
        assertEquals(input, WatchFrameDecoder.decode(WatchFrameBuilder.encode(frame))!!.motionFacts)
        assertNull(WatchMotionFacts.decode(List(9) { Double.NaN }))
    }
    @Test fun `different clocks delayed frames and source resets`() {
        val clock = WatchMotionClock()
        assertEquals(0.0, clock.accept(facts(epoch), 10_000.0)!!, 0.001)
        assertEquals(0.0, clock.accept(facts(epoch + 250), 10_250.0)!!, 0.001)
        assertEquals(500.0, clock.accept(facts(epoch + 500), 11_000.0)!!, 0.001)
        assertNull(clock.accept(facts(epoch + 250), 11_100.0))
        assertEquals(0.0, clock.accept(facts(epoch + 1250, source = epoch + 2), 12_000.0)!!, 0.001)
        assertNull(clock.accept(facts(epoch + 2000), 13_000.0))
    }
    @Test fun `replay rate separates producer clock from delivery delay`() {
        val clock = WatchMotionClock()
        var frame = facts(1_000_000.0).copy(clockRate = 4.0)
        assertEquals(0.0, clock.accept(frame, 0.0)!!, 0.001)
        frame = frame.copy(sentAt = 1_001_000.0)
        assertEquals(500.0, clock.accept(frame, 750.0)!!, 0.001)
        frame = frame.copy(sentAt = 1_002_000.0, clockRate = 1.0)
        assertEquals(500.0, clock.accept(frame, 1_000.0)!!, 0.001)
        frame = frame.copy(sentAt = 1_003_000.0)
        assertEquals(500.0, clock.accept(frame, 2_000.0)!!, 0.001)
        assertNull(clock.accept(frame, 2_100.0))
        frame = frame.copy(sourceId = epoch + 2, sentAt = 1_004_000.0)
        assertEquals(0.0, clock.accept(frame, 2_000.0)!!, 0.001)
    }
    @Test fun `speed frames preserve correction and camera lags point`() {
        val display = WatchDisplayMotion()
        fun feed(east: Double, fix: Double, now: Double, speed: Double) {
            val facts = facts(epoch + now, fix = fix).copy(gpsAgeMs = now - fix, boardAgeMs = 0.0)
            assertTrue(display.accept(WatchMapPosition(0.0, east / 111320), facts, speed, now))
        }
        feed(0.0, 0.0, 0.0, 20.0); display.offsetAt(0.0)
        feed(10.0, 1000.0, 1000.0, 20.0); display.offsetAt(1000.0)
        for (i in 1..18) display.offsetAt(1000 + i * 1000.0 / 60)
        feed(10.0, 1000.0, 1300.0, 10.0)
        for (i in 1..18) display.offsetAt(1300 + i * 1000.0 / 60)
        feed(10.0, 1000.0, 1600.0, 0.0)
        assertEquals(11.25, display.model.position(2000.0)!!.first * 111320, 0.0001)
        assertTrue(display.riderOffsetAt(1900.0).eastM > 0)
        assertEquals(11.25, display.model.position(2500.0)!!.first * 111320, 0.0001)
    }
    @Test fun `reset without fix rejects old frames before geometry returns`() {
        val intake = WatchMirrorIntake()
        val first = PhoneFrame(null, null, null, null, null, true, motionFacts = facts(epoch))
        val reset = first.copy(motionFacts = facts(epoch + 100, source = epoch + 2))
        assertTrue(intake.acceptTelemetry(WatchFrameBuilder.encode(first), 0, 0))
        assertTrue(intake.acceptTelemetry(WatchFrameBuilder.encode(reset), 100, 100))
        assertFalse(intake.acceptTelemetry(WatchFrameBuilder.encode(first), 200, 200))
    }
    @Test fun `replay rate changes preserve display position without rewriting fix time`() {
        val display = WatchDisplayMotion()
        val first = facts(epoch, fix = 100000.0).copy(gpsAgeMs = 0.0, clockRate = 4.0)
        assertTrue(display.accept(WatchMapPosition(0.0, 0.0), first, null, 0.0))
        val next = first.copy(sentAt = epoch + 250, fixTimestamp = 101000.0)
        assertTrue(display.accept(WatchMapPosition(0.0, 10.0 / 111320), next, null, 250.0))
        assertEquals(5.0, display.position(375.0)!!.first * 111320, 0.0001)
        assertTrue(display.accept(WatchMapPosition(0.0, 10.0 / 111320), next.copy(sentAt = epoch + 375, gpsAgeMs = 500.0, clockRate = 1.0), null, 375.0))
        assertEquals(5.0, display.position(375.0)!!.first * 111320, 0.0001)
        assertEquals(10.0, display.position(875.0)!!.first * 111320, 0.0001)
    }

}
