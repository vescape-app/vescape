package expo.modules.vescapecore.alerts

/**
 * A rule's `soundType` read through the sound string grammar `kind(variant):sound`. Only the first
 * `:` after the kind and optional variant splits, so the sound part (TTS text) may contain `:`.
 * Strings outside the grammar (no `kind:` prefix) parse to null.
 *
 * Only `tts` has a typed reading today; `alert`, `geiger`, and `voice` plug in as new readings of
 * the same parsed parts.
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
 * Severity of a spoken announcement: picks the sound played once before the speech. Until effects
 * packs land (#578) each maps to a bundled single sound.
 *
 * @parity /src/modules/alerts/lib/alertSoundString.ts `ALERT_SEVERITIES`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `AlertSeverity`
 */
internal enum class AlertSeverity(val id: String, val soundType: String) {
    INFO("info", "preset:notify"),
    WARNING("warning", "preset:beep"),
    CRITICAL("critical", "preset:urgent");

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
