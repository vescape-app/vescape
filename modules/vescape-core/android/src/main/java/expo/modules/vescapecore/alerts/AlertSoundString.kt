package expo.modules.vescapecore.alerts

/**
 * @parity /modules/vescape-core/src/index.ts `ALERT_BEEP_COUNT_RANGE`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `alertBeepCountRange`
 */
val ALERT_BEEP_COUNT_RANGE = 1..5

/**
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `presetRulePrefix`
 */
internal const val PRESET_RULE_PREFIX = "preset:"

/**
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
 * @parity /src/modules/alerts/lib/alertSoundString.ts `ALERT_SEVERITIES`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `AlertSeverity`
 */
internal enum class AlertSeverity(val id: String) {
    INFO("info"),
    WARNING("warning"),
    CRITICAL("critical");

    val slot: String get() = "severity.$id"

    companion object {
        fun from(raw: String?): AlertSeverity = entries.firstOrNull { it.id == raw } ?: WARNING
    }
}

internal data class TtsAlertSound(val severity: AlertSeverity, val text: String)

internal fun parseTtsAlertSound(spec: String): TtsAlertSound? {
    val parsed = AlertSoundString.parse(spec) ?: return null
    if (parsed.kind != "tts") return null
    return TtsAlertSound(AlertSeverity.from(parsed.variant), parsed.sound)
}

/**
 * @parity /src/modules/alerts/lib/alertSoundString.ts `parseVoiceAlertSound`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `parseVoiceAlertSound`
 */
internal data class VoiceAlertSound(val severity: AlertSeverity, val key: String?, val value: Double?)

internal fun parseVoiceAlertSound(spec: String): VoiceAlertSound? {
    val parsed = AlertSoundString.parse(spec) ?: return null
    if (parsed.kind != "voice") return null
    val key = parsed.sound.substringBefore(':').ifEmpty { null }
    val value = parsed.sound.substringAfter(':', "").toDoubleOrNull()?.takeIf { it.isFinite() }
    return VoiceAlertSound(AlertSeverity.from(parsed.variant), key, value)
}

internal fun isSpokenSpec(spec: String): Boolean =
    parseTtsAlertSound(spec) != null || parseVoiceAlertSound(spec) != null

internal data class SlotAlertSound(val count: Int, val severity: AlertSeverity)

/**
 * @parity /src/modules/alerts/lib/alertSoundString.ts `parseSlotAlertSound`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `parseSlotAlertSound`
 */
internal fun parseSlotAlertSound(spec: String): SlotAlertSound {
    val parsed = AlertSoundString.parse(spec)
    if (parsed?.kind == "alert") {
        val count = parsed.variant?.toIntOrNull()?.coerceIn(ALERT_BEEP_COUNT_RANGE.first, ALERT_BEEP_COUNT_RANGE.last) ?: 1
        return SlotAlertSound(count, AlertSeverity.entries.firstOrNull { it.id == parsed.sound } ?: AlertSeverity.WARNING)
    }
    val legacy = when (spec) {
        "preset:notify", "notify", "pulse" -> AlertSeverity.INFO
        "preset:urgent", "urgent" -> AlertSeverity.CRITICAL
        else -> AlertSeverity.WARNING
    }
    return SlotAlertSound(1, legacy)
}

/**
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
 * @parity /src/modules/alerts/lib/alertSoundString.ts `parseGeigerAlertSound`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `parseGeigerAlertSound`
 */
internal fun parseGeigerAlertSound(spec: String): GeigerLevel? {
    LEGACY_GEIGER[spec]?.let { return it }
    val parsed = AlertSoundString.parse(spec)
    if (parsed?.kind != "geiger") return null
    return GeigerLevel.entries.firstOrNull { it.id == parsed.sound } ?: GeigerLevel.SOFT
}

/**
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `geigerSlot`
 */
internal fun geigerSlot(spec: String): String = (parseGeigerAlertSound(spec) ?: GeigerLevel.SOFT).slot

internal fun isGeigerSpec(spec: String): Boolean = parseGeigerAlertSound(spec) != null

/**
 * @parity /src/modules/alerts/lib/alertSoundString.ts `mySoundId`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `mySoundId`
 */
internal fun mySoundId(spec: String): String? {
    val parsed = AlertSoundString.parse(spec) ?: return null
    if (parsed.kind != "alert" && parsed.kind != "geiger") return null
    return parsed.sound.removePrefix("my:").takeIf { parsed.sound.startsWith("my:") && it.isNotEmpty() }
}

/**
 * @parity /src/modules/alerts/lib/alertSoundString.ts `parseAlertPresetSpec`
 * @parity /modules/vescape-core/ios/alerts/AlertSoundString.swift `AlertPresetSpec`
 */
internal data class AlertPresetSpec(val level: String, val options: List<Pair<String, String>> = emptyList()) {
    fun option(key: String): String? = options.firstOrNull { it.first == key }?.second

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
        private val pattern = Regex("preset\\(([^()]*)\\)(?::(.*))?", RegexOption.DOT_MATCHES_ALL)

        fun parse(raw: String): AlertPresetSpec? {
            val match = pattern.matchEntire(raw) ?: return null
            val options = match.groupValues[2].split(',').mapNotNull { entry ->
                val separator = entry.indexOf('=')
                if (separator <= 0) null else entry.substring(0, separator) to entry.substring(separator + 1)
            }
            return AlertPresetSpec(match.groupValues[1], options)
        }
    }
}
