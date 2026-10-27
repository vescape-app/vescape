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
            "battery": { "start": ["b.0"], "minimal": ["bm.0"] },
            "battery.critical": {
              "start": ["bc.0"],
              "full": { "start": ["bcf.0", "bcf.1"], "end": ["plug"], "endChance": 0.2 }
            },
            "motorTemp": { "start": ["m.0"] }
          },
          "values": {
            "percent": { "20": "p20", "30": "p30" },
            "duration": { "150": "in150" },
            "degrees": { "-5": "dm5", "95": "d95", "203": "d203" }
          }
        }
    """.trimIndent()))

    private fun battery(severity: AlertSeverity, wording: VoiceWording, value: Int? = 20) =
        VoiceAnnouncement(severity, "battery", listOfNotNull(value?.let { VoiceValue("percent", it) }), wording)

    @Test
    fun matchingFollowsTheEffectsPackVoice() {
        assertEquals("radio", voicePackId("matching", "radio"))
        assertEquals("nova", voicePackId("matching", null))
        assertEquals("nova", voicePackId("matching", "santa"))
        assertEquals("radio", voicePackId("radio", "nova"))
        assertEquals("nicole", voicePackId("nicole", null))
        assertEquals("nova", voicePackId("santa", null))
    }

    @Test
    fun announcementTakesKeyFromMetricAndValueFromThreshold() {
        val custom = VoiceAlertSound(AlertSeverity.INFO, null, null)
        assertEquals(VoiceAnnouncement(AlertSeverity.INFO, "battery", listOf(VoiceValue("percent", 20))), voiceAnnouncement(custom, "battery", 19.6, true, "km", "celsius"))
        // Without a battery config the threshold is volts, not a percent.
        assertEquals(VoiceAnnouncement(AlertSeverity.INFO, "battery"), voiceAnnouncement(custom, "battery", 42.0, false, "km", "celsius"))
        assertEquals(VoiceAnnouncement(AlertSeverity.INFO, null), voiceAnnouncement(custom, "power", 30.0, true, "km", "celsius"))
        val preset = VoiceAlertSound(AlertSeverity.CRITICAL, "motorTemp", null)
        assertEquals(VoiceAnnouncement(AlertSeverity.CRITICAL, "motorTemp", listOf(VoiceValue("degrees", 95))), voiceAnnouncement(preset, "motor-temp", 95.0, false, "km", "celsius"))
        // °F converts before rounding: 95 °C = 203 °F, −20.6 °C = −5.08 °F.
        assertEquals(203, voiceAnnouncement(preset, "motor-temp", 95.0, false, "km", "fahrenheit").values.single().value)
        assertEquals(-5, voiceAnnouncement(preset, "motor-temp", -20.6, false, "km", "fahrenheit").values.single().value)
        // Degrees follow the temperature unit, not the distance unit.
        assertEquals(95, voiceAnnouncement(preset, "motor-temp", 95.0, false, "mi", "celsius").values.single().value)
        val explicit = VoiceAlertSound(AlertSeverity.WARNING, "battery", 10.0)
        assertEquals(10, voiceAnnouncement(explicit, "speed", 50.0, false, "km", "celsius").values.single().value)
        // Speed reads in mph under mi (50 km/h = 31.07 mph); duty stays a percent.
        val speed = VoiceAlertSound(AlertSeverity.WARNING, null, null)
        assertEquals(VoiceAnnouncement(AlertSeverity.WARNING, "speed", listOf(VoiceValue("number", 50))), voiceAnnouncement(speed, "speed", 50.0, false, "km", "celsius"))
        assertEquals(31, voiceAnnouncement(speed, "speed", 50.0, false, "mi", "celsius").values.single().value)
        assertEquals(VoiceAnnouncement(AlertSeverity.WARNING, "dutyCycle", listOf(VoiceValue("number", 85))), voiceAnnouncement(speed, "duty", 85.0, false, "mi", "celsius"))
    }

    @Test
    fun eachWordingPicksItsPhrasesThenFallsBack() {
        val picker = VoiceVariantPicker { 0 }
        // Standard: the severity line's start, never an ending.
        assertEquals(listOf("bc.0", "p20"), picker.clips(manifest, battery(AlertSeverity.CRITICAL, VoiceWording.STANDARD)))
        assertEquals(listOf("b.0", "p20"), picker.clips(manifest, battery(AlertSeverity.WARNING, VoiceWording.STANDARD)))
        // Minimal: the generic line's minimal phrase, whatever the severity; start when it has none.
        assertEquals(listOf("bm.0", "p20"), picker.clips(manifest, battery(AlertSeverity.CRITICAL, VoiceWording.MINIMAL)))
        assertEquals(listOf("m.0", "dm5"), picker.clips(manifest, VoiceAnnouncement(AlertSeverity.CRITICAL, "motorTemp", listOf(VoiceValue("degrees", -5)), VoiceWording.MINIMAL)))
        // Full: the full pool with its ending; start when the line has no pool.
        assertEquals(listOf("bcf.0", "p20", "plug"), picker.clips(manifest, battery(AlertSeverity.CRITICAL, VoiceWording.FULL)))
        assertEquals(listOf("b.0", "p20"), picker.clips(manifest, battery(AlertSeverity.WARNING, VoiceWording.FULL)))
        // A missing value clip is skipped, the line still plays.
        assertEquals(listOf("b.0"), picker.clips(manifest, battery(AlertSeverity.INFO, VoiceWording.STANDARD, 77)))
        assertNull(picker.clips(manifest, VoiceAnnouncement(AlertSeverity.INFO, "controllerTemp", listOf(VoiceValue("degrees", 80)))))
        assertNull(picker.clips(manifest, VoiceAnnouncement(AlertSeverity.INFO, null)))
    }

    @Test
    fun multipleValuesPlayInOrderSkippingMissingClips() {
        val picker = VoiceVariantPicker { 0 }
        val rain = { values: List<VoiceValue> -> VoiceAnnouncement(AlertSeverity.CRITICAL, "battery", values, VoiceWording.FULL) }
        assertEquals(
            listOf("bcf.0", "in150", "p30", "plug"),
            picker.clips(manifest, rain(listOf(VoiceValue("duration", 150), VoiceValue("percent", 30)))),
        )
        // The type travels with each value: 30 as a duration has no clip, the percent still plays.
        assertEquals(
            listOf("bcf.1", "p30", "plug"),
            picker.clips(manifest, rain(listOf(VoiceValue("duration", 30), VoiceValue("percent", 30)))),
        )
        assertEquals(listOf("bcf.0", "plug"), picker.clips(manifest, rain(listOf(VoiceValue("wind", 150)))))
    }

    @Test
    fun anEndingPlaysOnlyAtItsChance() {
        // Per pick: start variant, then a 0–99 roll that ends the line below 20, then the ending.
        val picks = ArrayDeque(listOf(0, 19, 0, 0, 20, 0, 99))
        val picker = VoiceVariantPicker { picks.removeFirst() }
        val critical = battery(AlertSeverity.CRITICAL, VoiceWording.FULL)
        assertEquals(listOf("bcf.0", "p20", "plug"), picker.clips(manifest, critical))
        assertEquals(listOf("bcf.1", "p20"), picker.clips(manifest, critical))
    }

    @Test
    fun neverRepeatsTheSameStartTwiceInARow() {
        val picker = VoiceVariantPicker { 0 }
        val critical = battery(AlertSeverity.CRITICAL, VoiceWording.FULL, null)
        assertEquals("bcf.0", picker.clips(manifest, critical)!!.first())
        assertEquals("bcf.1", picker.clips(manifest, critical)!!.first())
        assertEquals("bcf.0", picker.clips(manifest, critical)!!.first())
    }

    @Test
    fun nextIsThePickTheFollowingAnnouncementPlays() {
        val picker = VoiceVariantPicker { 0 }
        val critical = battery(AlertSeverity.CRITICAL, VoiceWording.FULL)
        assertNull(picker.next(manifest, critical))
        assertEquals(listOf("bcf.0", "p20", "plug"), picker.clips(manifest, critical))
        val ahead = picker.next(manifest, critical)
        assertEquals(listOf("bcf.1", "p20", "plug"), ahead)
        assertEquals(ahead, picker.clips(manifest, critical))
        // Wordings keep separate picks.
        assertNull(picker.next(manifest, battery(AlertSeverity.CRITICAL, VoiceWording.STANDARD)))
    }

    @Test
    fun trimsOnlyLeadingPadding() {
        assertEquals(3, leadingSilenceFrames(shortArrayOf(0, 10, -20, 500, 0)))
        assertEquals(0, leadingSilenceFrames(shortArrayOf(-900, 0)))
        assertEquals(4, leadingSilenceFrames(ShortArray(10), maxFrames = 4))
    }
}
