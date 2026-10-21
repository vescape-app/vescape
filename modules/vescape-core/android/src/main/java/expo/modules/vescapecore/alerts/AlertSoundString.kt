package expo.modules.vescapecore.alerts

/**
 * Inclusive bounds on the count of an `alert(count):severity` sound.
 *
 * @parity /modules/vescape-core/src/index.ts `ALERT_BEEP_COUNT_RANGE`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `alertBeepCountRange`
 */
val ALERT_BEEP_COUNT_RANGE = 1..5

/**
 * Id prefix of Alert Preset rows (`preset:<metric>`) and the rules they expand to
 * (`preset:<metric>:<index>`), the rules Voice level applies to.
 *
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `presetRulePrefix`
 */
internal const val PRESET_RULE_PREFIX = "preset:"

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

/**
 * `voice(severity):key:value` — the severity sound once, then the voice pack's line for [key] with
 * [value] spoken last. A custom rule stores `voice(severity):`: key from its metric, value from its
 * threshold. A [value] is in the key's metric unit (%, °C).
 *
 * @parity /src/modules/alerts/lib/alertSoundString.ts `parseVoiceAlertSound`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `parseVoiceAlertSound`
 */
internal data class VoiceAlertSound(val severity: AlertSeverity, val key: String?, val value: Double?)

internal fun parseVoiceAlertSound(soundType: String): VoiceAlertSound? {
    val parsed = AlertSoundString.parse(soundType) ?: return null
    if (parsed.kind != "voice") return null
    val key = parsed.sound.substringBefore(':').ifEmpty { null }
    val value = parsed.sound.substringAfter(':', "").toDoubleOrNull()?.takeIf { it.isFinite() }
    return VoiceAlertSound(AlertSeverity.from(parsed.variant), key, value)
}

/** True for a `soundType` spoken after its severity sound: system TTS or a voice line. */
internal fun isSpokenSoundType(soundType: String): Boolean =
    parseTtsAlertSound(soundType) != null || parseVoiceAlertSound(soundType) != null

/** `alert(count):severity` — the active effects pack's severity sound, [count] times. */
internal data class SlotAlertSound(val count: Int, val severity: AlertSeverity)

/**
 * Read any non-TTS single-alert `soundType` as a slot sound. `alert:` means one play. Strings from
 * before the grammar map onto the matching severity (`preset:notify|beep|urgent` → info, warning,
 * critical, played once); anything unknown plays the warning sound once, so a rule is never silent.
 * A `my:<id>` sound reads as warning too: the fallback when that My sound is gone (see [mySoundId]).
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

/**
 * Tick level of a geiger (range) rule: picks the active effects pack's `geiger.<id>` slot.
 *
 * @parity /src/modules/alerts/lib/alertSoundString.ts `GEIGER_LEVELS`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `GeigerLevel`
 */
internal enum class GeigerLevel(val id: String) {
    SOFT("soft"),
    MID("mid"),
    HARD("hard");

    val slot: String get() = "geiger.$id"
}

private val LEGACY_GEIGER = mapOf(
    "preset:tick" to GeigerLevel.SOFT,
    "preset:tick_hard" to GeigerLevel.MID,
    "preset:gamma" to GeigerLevel.HARD,
    "preset:sustained" to GeigerLevel.HARD,
)

/**
 * `geiger:level` — a range rule's tick level, or null when [soundType] is not a geiger sound.
 * Strings from before the grammar map `preset:tick|tick_hard|gamma|sustained` → soft, mid, hard,
 * hard. An unknown level ticks soft, as does `geiger:my:<id>` when that My sound is gone.
 *
 * @parity /src/modules/alerts/lib/alertSoundString.ts `parseGeigerAlertSound`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `parseGeigerAlertSound`
 */
internal fun parseGeigerAlertSound(soundType: String): GeigerLevel? {
    LEGACY_GEIGER[soundType]?.let { return it }
    val parsed = AlertSoundString.parse(soundType)
    if (parsed?.kind != "geiger") return null
    return GeigerLevel.entries.firstOrNull { it.id == parsed.sound } ?: GeigerLevel.SOFT
}

/**
 * Geiger slot for a range rule's `soundType` (see [parseGeigerAlertSound]); a non-geiger string
 * ticks soft.
 *
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `geigerSlot`
 */
internal fun geigerSlot(soundType: String): String = (parseGeigerAlertSound(soundType) ?: GeigerLevel.SOFT).slot

/** True for a `soundType` that names a geiger tick rather than a single alert sound. */
internal fun isGeigerSoundType(soundType: String): Boolean = parseGeigerAlertSound(soundType) != null

/**
 * My sound id of an `alert(count):my:<id>` or `geiger:my:<id>` sound, else null. The player uses it
 * when the sound still exists and falls back to the parsed pack slot otherwise, never silence.
 *
 * @parity /src/modules/alerts/lib/alertSoundString.ts `mySoundId`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `mySoundId`
 */
internal fun mySoundId(soundType: String): String? {
    val parsed = AlertSoundString.parse(soundType) ?: return null
    if (parsed.kind != "alert" && parsed.kind != "geiger") return null
    return parsed.sound.removePrefix("my:").takeIf { parsed.sound.startsWith("my:") && it.isNotEmpty() }
}

/**
 * `preset(level):key=value,…` — an Alert Preset row's spec: the rider's level plus options, nothing
 * else (the shipped definition owns every point). Unknown keys are kept in order, so rewriting one
 * option never drops what a newer app stored. An entry without `=` is not an option and is dropped.
 *
 * @parity /src/modules/alerts/lib/alertSoundString.ts `parseAlertPresetSpec`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `AlertPresetSpec`
 */
internal data class AlertPresetSpec(val level: String, val options: List<Pair<String, String>> = emptyList()) {
    fun option(key: String): String? = options.firstOrNull { it.first == key }?.second

    /** This spec with [key] set to [value] in place, appended when new, or removed when null. */
    fun withOption(key: String, value: String?): AlertPresetSpec {
        val next = options.filterNot { it.first == key }.toMutableList()
        if (value != null) {
            val index = options.indexOfFirst { it.first == key }
            next.add(if (index < 0) next.size else index, key to value)
        }
        return copy(options = next)
    }

    fun encode(): String =
        "preset($level)" + if (options.isEmpty()) "" else options.joinToString(",", prefix = ":") { "${it.first}=${it.second}" }

    companion object {
        private val pattern = Regex("^preset\\(([^()]*)\\)(?::(.*))?$", RegexOption.DOT_MATCHES_ALL)

        fun parse(raw: String): AlertPresetSpec? {
            val match = pattern.find(raw) ?: return null
            val options = match.groupValues[2].split(',').mapNotNull { entry ->
                val separator = entry.indexOf('=')
                if (separator <= 0) null else entry.substring(0, separator) to entry.substring(separator + 1)
            }
            return AlertPresetSpec(match.groupValues[1], options)
        }
    }
}
