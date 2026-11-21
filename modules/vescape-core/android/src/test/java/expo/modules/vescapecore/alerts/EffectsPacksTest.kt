package expo.modules.vescapecore.alerts

import expo.modules.vescapecore.RideHazardCues
import expo.modules.vescapecore.RideHazardKind
import expo.modules.vescapecore.RiderSignalKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** @parity /modules/vescape-core/ios/alerts/EffectsPacksTests.swift */
class EffectsPacksTest {
    /** A pack filling only the required slots, without `cue.on` or `cue.off`. */
    private val packSlots = setOf("severity.positive", "severity.info", "severity.warning", "severity.critical")

    private fun lookup(slot: String, overrides: Set<String> = emptySet()) =
        lookupSlot(slot, { it in overrides }) { it in packSlots }

    @Test
    fun missingOptionalSlotsFallBackToTheirSeveritySound() {
        assertEquals("severity.positive", lookup("cue.on"))
        assertEquals("severity.warning", lookup("cue.off"))
    }

    @Test
    fun overrideOnTheOptionalSlotWins() {
        assertEquals("cue.on", lookup("cue.on", setOf("cue.on", "severity.positive")))
    }

    @Test
    fun overrideOnTheFallbackSlotCoversTheMissingCue() {
        assertEquals("severity.positive", lookup("cue.on", setOf("severity.positive")))
    }

    @Test
    fun removedCuesPlayFixedSeverities() {
        assertEquals("severity.critical", appCueSlot("error"))
        assertEquals("severity.info", appCueSlot("groupRide.riderJoined"))
        assertEquals("severity.warning", appCueSlot("groupRide.riderLeft"))
        assertEquals("severity.warning", appCueSlot("groupRide.lost"))
        assertEquals("severity.positive", appCueSlot("groupRide.restored"))
    }

    @Test
    fun riderSignalCuesPlayTheirSeverityAtAdvisoryPriority() {
        assertEquals("severity.critical", appCueSlot("groupRide.signal.serious"))
        assertEquals("severity.warning", appCueSlot("groupRide.signal.minor"))
        assertEquals("severity.info", appCueSlot("groupRide.signal.down"))
        assertEquals("severity.warning", appCueSlot("groupRide.signal.board"))
        assertEquals("severity.info", appCueSlot("groupRide.signal.wait"))
        assertEquals("severity.warning", appCueSlot("groupRide.hazard.terrain"))
        assertEquals("severity.info", appCueSlot("groupRide.hazard.sent"))
        assertNull(appCueSlot("groupRide.hazard.lava"))
        assertEquals(AnnouncementPriority.ADVISORY, appCuePriority("groupRide.hazard.water"))
        assertEquals("severity.positive", appCueSlot("groupRide.signal.ok"))
        assertEquals("groupRide.signal.wait", appCueVoiceKey("groupRide.signal.wait"))
        assertEquals(AnnouncementPriority.ADVISORY, appCuePriority("groupRide.signal.battery"))
        assertEquals(AnnouncementPriority.SOCIAL, appCuePriority("groupRide.riderJoined"))
    }

    @Test
    fun everySignalAndHazardKindHasACueWithItsSeverity() {
        for (kind in RiderSignalKind.entries) {
            val cue = "groupRide.signal.${kind.wire}"
            assertTrue(cue, cue in GROUP_RIDE_CUES)
            assertEquals(cue, "severity.${kind.severity.wire}", appCueSlot(cue))
        }
        for (kind in RideHazardKind.entries) {
            val cue = RideHazardCues.CUE_PREFIX + kind.wire
            assertTrue(cue, cue in GROUP_RIDE_CUES)
            assertEquals(cue, "severity.warning", appCueSlot(cue))
        }
    }
}
