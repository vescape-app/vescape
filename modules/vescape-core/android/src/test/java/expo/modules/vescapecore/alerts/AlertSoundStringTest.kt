package expo.modules.vescapecore.alerts

import org.junit.Assert.assertEquals
import org.junit.Test

/** @parity /modules/vescape-core/ios/alerts/AlertSoundStringTests.swift */
class AlertSoundStringTest {
    @Test
    fun parsesTheGrammarTable() {
        val cases = listOf(
            "tts(info):Battery low" to AlertSoundString("tts", "info", "Battery low"),
            "tts:Battery low" to AlertSoundString("tts", null, "Battery low"),
            "tts():x" to AlertSoundString("tts", null, "x"),
            "tts(critical):Time: 12:30" to AlertSoundString("tts", "critical", "Time: 12:30"),
            "tts:" to AlertSoundString("tts", null, ""),
            "alert(3):my:beep" to AlertSoundString("alert", "3", "my:beep"),
            "preset:beep" to AlertSoundString("preset", null, "beep"),
            "default" to null,
            "Tts:x" to null,
            "tts(warning:x" to null,
            "" to null,
        )
        for ((raw, expected) in cases) assertEquals(raw, expected, AlertSoundString.parse(raw))
    }

    @Test
    fun readsTtsSeverityDefaultingToWarning() {
        val cases = listOf(
            "tts(info):a" to TtsAlertSound(AlertSeverity.INFO, "a"),
            "tts(warning):a" to TtsAlertSound(AlertSeverity.WARNING, "a"),
            "tts(critical):a: b" to TtsAlertSound(AlertSeverity.CRITICAL, "a: b"),
            "tts:a" to TtsAlertSound(AlertSeverity.WARNING, "a"),
            "tts(loud):a" to TtsAlertSound(AlertSeverity.WARNING, "a"),
            "preset:beep" to null,
            "default" to null,
        )
        for ((raw, expected) in cases) assertEquals(raw, expected, parseTtsAlertSound(raw))
    }

    @Test
    fun readsSlotAlertSoundsWithLegacyAndUnknownFallbacks() {
        val cases = listOf(
            "alert(3):warning" to SlotAlertSound(3, AlertSeverity.WARNING),
            "alert(1):critical" to SlotAlertSound(1, AlertSeverity.CRITICAL),
            "alert:info" to SlotAlertSound(1, AlertSeverity.INFO),
            "alert(9):info" to SlotAlertSound(5, AlertSeverity.INFO),
            "alert(0):info" to SlotAlertSound(1, AlertSeverity.INFO),
            "alert(x):critical" to SlotAlertSound(1, AlertSeverity.CRITICAL),
            "alert(2):my:beep" to SlotAlertSound(2, AlertSeverity.WARNING),
            "alert(2):loud" to SlotAlertSound(2, AlertSeverity.WARNING),
            "preset:beep" to SlotAlertSound(1, AlertSeverity.WARNING),
            "preset:urgent" to SlotAlertSound(1, AlertSeverity.CRITICAL),
            "preset:notify" to SlotAlertSound(1, AlertSeverity.INFO),
            "default" to SlotAlertSound(1, AlertSeverity.WARNING),
            "nonsense" to SlotAlertSound(1, AlertSeverity.WARNING),
        )
        for ((raw, expected) in cases) assertEquals(raw, expected, parseSlotAlertSound(raw))
    }

    @Test
    fun readsGeigerLevelsWithLegacyAndUnknownFallbacks() {
        val cases = listOf(
            "geiger:soft" to GeigerLevel.SOFT,
            "geiger:mid" to GeigerLevel.MID,
            "geiger:hard" to GeigerLevel.HARD,
            "geiger:loud" to GeigerLevel.SOFT,
            "geiger:my:abc" to GeigerLevel.SOFT,
            "preset:tick" to GeigerLevel.SOFT,
            "preset:tick_hard" to GeigerLevel.MID,
            "preset:gamma" to GeigerLevel.HARD,
            "preset:sustained" to GeigerLevel.HARD,
            "alert:warning" to null,
            "preset:beep" to null,
            "default" to null,
        )
        for ((raw, expected) in cases) assertEquals(raw, expected, parseGeigerAlertSound(raw))
    }
}
