package expo.modules.vescapecore.alerts

/**
 * A rule's `soundType` read through the sound string grammar `kind(variant):sound`. Only the first
 * `:` after the kind and optional variant splits, so the sound part (TTS text) may contain `:`.
 * Strings outside the grammar (no `kind:` prefix) parse to null.
 *
 * `tts` and `alert` have typed readings; `geiger` and `voice` plug in as new readings of the same
 * parsed parts.
 *
 * @parity /src/modules/alerts/lib/alertSoundString.ts
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift
 */
internal data class AlertSoundString(val kind: String, val variant: String?, val sound: String) {
    companion object {
        private val pattern = Regex("^([a-z]+)(?:\\(([^()]*)\\))?:(.*)$", RegexOption.DOT_MATCHES_ALL)

        fun parse(raw: String): AlertSoundString? {
            val match = pattern.find(raw) ?: return null
            val (kind, variant, sound) = match.destructured
            return AlertSoundString(kind, variant.ifEmpty { null }, sound)
        }
    }
}

/**
 * Severity of an announcement: picks the active effects pack's `severity.<id>` slot, played before
 * speech or as an alert rule's sound.
 *
 * @parity /src/modules/alerts/lib/alertSoundString.ts `ALERT_SEVERITIES`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `AlertSeverity`
 */
internal enum class AlertSeverity(val id: String) {
    INFO("info"),
    WARNING("warning"),
    CRITICAL("critical");

    val slot: String get() = "severity.$id"

    companion object {
        /** Absent or unknown severities read as [WARNING]. */
        fun from(raw: String?): AlertSeverity = entries.firstOrNull { it.id == raw } ?: WARNING
    }
}

/** `tts(severity):text` — the severity sound once, then system TTS speaking [text]. */
internal data class TtsAlertSound(val severity: AlertSeverity, val text: String)

internal fun parseTtsAlertSound(soundType: String): TtsAlertSound? {
    val parsed = AlertSoundString.parse(soundType) ?: return null
    if (parsed.kind != "tts") return null
    return TtsAlertSound(AlertSeverity.from(parsed.variant), parsed.sound)
}

/** `alert(count):severity` — the active effects pack's severity sound, [count] times. */
internal data class SlotAlertSound(val count: Int, val severity: AlertSeverity)

/**
 * Read any non-TTS single-alert `soundType` as a slot sound. `alert:` means one play. Strings from
 * before the grammar map onto the matching severity (`preset:notify|beep|urgent` → info, warning,
 * critical, played once); anything unknown, including a not-yet-supported `my:` sound, plays the
 * warning sound once, so a rule is never silent.
 *
 * @parity /src/modules/alerts/lib/alertSoundString.ts `parseSlotAlertSound`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `parseSlotAlertSound`
 */
internal fun parseSlotAlertSound(soundType: String): SlotAlertSound {
    val parsed = AlertSoundString.parse(soundType)
    if (parsed?.kind == "alert") {
        val count = parsed.variant?.toIntOrNull()?.coerceIn(ALERT_BEEP_COUNT_RANGE.first, ALERT_BEEP_COUNT_RANGE.last) ?: 1
        return SlotAlertSound(count, AlertSeverity.entries.firstOrNull { it.id == parsed.sound } ?: AlertSeverity.WARNING)
    }
    val legacy = when (soundType) {
        "preset:notify", "notify", "pulse" -> AlertSeverity.INFO
        "preset:urgent", "urgent" -> AlertSeverity.CRITICAL
        else -> AlertSeverity.WARNING
    }
    return SlotAlertSound(1, legacy)
}
