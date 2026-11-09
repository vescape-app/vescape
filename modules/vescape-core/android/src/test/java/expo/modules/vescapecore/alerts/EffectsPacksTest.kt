package expo.modules.vescapecore.alerts

import org.junit.Assert.assertEquals
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
        assertEquals("severity.critical", appCueSlot("groupRide.signal.down"))
        assertEquals("severity.critical", appCueSlot("groupRide.signal.help"))
        assertEquals("severity.warning", appCueSlot("groupRide.signal.board"))
        assertEquals("severity.positive", appCueSlot("groupRide.signal.ok"))
        assertEquals("groupRide.signal.wait", appCueVoiceKey("groupRide.signal.wait"))
        assertEquals(AnnouncementPriority.ADVISORY, appCuePriority("groupRide.signal.battery"))
        assertEquals(AnnouncementPriority.SOCIAL, appCuePriority("groupRide.riderJoined"))
    }
}
