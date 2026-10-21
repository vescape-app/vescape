package expo.modules.vescapecore.alerts

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** @parity /modules/vescape-core/ios/alerts/VoicePacksTests.swift */
class VoicePacksTest {
    private val manifest = VoicePackManifest.parse(JSONObject("""
        {
          "lines": {
            "battery": { "start": ["b.0"], "end": [] },
            "battery.critical": { "start": ["bc.0", "bc.1"], "end": ["plug"] },
            "motorTemp": { "start": ["m.0"], "end": [] },
            "motorTemp.warning": { "start": ["mw.0"], "end": ["soon", ""] }
          },
          "values": {
            "percent": { "20": "p20" },
            "degrees": { "-5": "dm5", "95": "d95", "203": "d203" }
          }
        }
    """.trimIndent()))

    @Test
    fun matchingFollowsTheEffectsPackVoice() {
        assertEquals("hev", voicePackId("matching", "hev"))
        assertEquals("clean", voicePackId("matching", null))
        assertEquals("clean", voicePackId("matching", "santa"))
        assertEquals("hev", voicePackId("hev", "clean"))
        assertEquals("clean", voicePackId("nicole", null))
    }

    @Test
    fun announcementTakesKeyFromMetricAndValueFromThreshold() {
        val custom = VoiceAlertSound(AlertSeverity.INFO, null, null)
        assertEquals(VoiceAnnouncement(AlertSeverity.INFO, "battery", 20), voiceAnnouncement(custom, "battery", 19.6, true, "metric"))
        // Without a battery config the threshold is volts, not a percent.
        assertEquals(VoiceAnnouncement(AlertSeverity.INFO, "battery", null), voiceAnnouncement(custom, "battery", 42.0, false, "metric"))
        assertEquals(VoiceAnnouncement(AlertSeverity.INFO, null, null), voiceAnnouncement(custom, "power", 30.0, true, "metric"))
        val preset = VoiceAlertSound(AlertSeverity.CRITICAL, "motorTemp", null)
        assertEquals(VoiceAnnouncement(AlertSeverity.CRITICAL, "motorTemp", 95), voiceAnnouncement(preset, "motor-temp", 95.0, false, "metric"))
        // °F converts before rounding: 95 °C = 203 °F, −20.6 °C = −5.08 °F.
        assertEquals(203, voiceAnnouncement(preset, "motor-temp", 95.0, false, "imperial").value)
        assertEquals(-5, voiceAnnouncement(preset, "motor-temp", -20.6, false, "imperial").value)
        val explicit = VoiceAlertSound(AlertSeverity.WARNING, "battery", 10.0)
        assertEquals(10, voiceAnnouncement(explicit, "speed", 50.0, false, "metric").value)
        // Speed reads in mph under imperial (50 km/h = 31.07 mph); duty stays a percent.
        val speed = VoiceAlertSound(AlertSeverity.WARNING, null, null)
        assertEquals(VoiceAnnouncement(AlertSeverity.WARNING, "speed", 50), voiceAnnouncement(speed, "speed", 50.0, false, "metric"))
        assertEquals(31, voiceAnnouncement(speed, "speed", 50.0, false, "imperial").value)
        assertEquals(VoiceAnnouncement(AlertSeverity.WARNING, "duty", 85), voiceAnnouncement(speed, "duty", 85.0, false, "imperial"))
    }

    @Test
    fun resolvesSeverityVariantThenGenericThenNothing() {
        val picker = VoiceVariantPicker { 0 }
        assertEquals(listOf("bc.0", "p20", "plug"), picker.clips(manifest, VoiceAnnouncement(AlertSeverity.CRITICAL, "battery", 20)))
        assertEquals(listOf("b.0", "p20"), picker.clips(manifest, VoiceAnnouncement(AlertSeverity.WARNING, "battery", 20)))
        // A missing value clip is skipped, the line still plays.
        assertEquals(listOf("b.0"), picker.clips(manifest, VoiceAnnouncement(AlertSeverity.INFO, "battery", 77)))
        assertEquals(listOf("m.0", "dm5"), picker.clips(manifest, VoiceAnnouncement(AlertSeverity.INFO, "motorTemp", -5)))
        assertNull(picker.clips(manifest, VoiceAnnouncement(AlertSeverity.INFO, "controllerTemp", 80)))
        assertNull(picker.clips(manifest, VoiceAnnouncement(AlertSeverity.INFO, null, null)))
    }

    @Test
    fun neverRepeatsTheSameStartTwiceInARow() {
        val picker = VoiceVariantPicker { 0 }
        val critical = VoiceAnnouncement(AlertSeverity.CRITICAL, "battery", null)
        assertEquals("bc.0", picker.clips(manifest, critical)!!.first())
        assertEquals("bc.1", picker.clips(manifest, critical)!!.first())
        assertEquals("bc.0", picker.clips(manifest, critical)!!.first())
    }

    @Test
    fun nextIsThePickTheFollowingAnnouncementPlays() {
        val picks = ArrayDeque(listOf(1, 0, 0, 0, 0, 0))
        val picker = VoiceVariantPicker { picks.removeFirst() }
        val critical = VoiceAnnouncement(AlertSeverity.CRITICAL, "battery", 20)
        assertNull(picker.next(manifest, critical))
        assertEquals(listOf("bc.1", "p20", "plug"), picker.clips(manifest, critical))
        val ahead = picker.next(manifest, critical)
        assertEquals(listOf("bc.0", "p20", "plug"), ahead)
        assertEquals(ahead, picker.clips(manifest, critical))
    }

    @Test
    fun anEmptyEndIsTheNoneVariant() {
        val picks = ArrayDeque(listOf(0, 1, 0, 0, 0, 0))
        val picker = VoiceVariantPicker { picks.removeFirst() }
        val warning = VoiceAnnouncement(AlertSeverity.WARNING, "motorTemp", null)
        assertEquals(listOf("mw.0"), picker.clips(manifest, warning))
        assertEquals(listOf("mw.0", "soon"), picker.clips(manifest, warning))
    }

    @Test
    fun trimsOnlyLeadingPadding() {
        assertEquals(3, leadingSilenceFrames(shortArrayOf(0, 10, -20, 500, 0)))
        assertEquals(0, leadingSilenceFrames(shortArrayOf(-900, 0)))
        assertEquals(4, leadingSilenceFrames(ShortArray(10), maxFrames = 4))
    }
}
