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
}
