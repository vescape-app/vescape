package expo.modules.vescapecore.alerts

import expo.modules.vescapecore.protocol.RefloatTelemetry

import expo.modules.vescapecore.telemetry.AlertRuleEntity

/** Id prefix of generated preset rules (`preset:<metric>:<index>`), the rules Voice level applies to. */
internal const val PRESET_RULE_PREFIX = "preset:"

/**
 * Packs one preset pins (#583), from the board's `alertPresetSound` setting; null follows the
 * app-wide choice. Resolution per slot: My sound override > pinned pack > app-wide.
 *
 * @parity /modules/vescape-core/ios/alerts/AlertCoordinator.swift `PresetSoundPin`
 */
internal data class PresetSoundPin(val effects: String? = null, val voice: String? = null) {
    companion object {
        /** Pins per preset metric in a decoded `alertPresetSound` setting; unknown pack ids follow the default. */
        fun from(raw: Any?): Map<String, PresetSoundPin> = (raw as? Map<*, *>).orEmpty().mapNotNull { (metric, value) ->
            val sound = value as? Map<*, *> ?: return@mapNotNull null
            val pin = PresetSoundPin(
                effects = (sound["effects"] as? String)?.takeIf { it in EFFECTS_PACK_IDS },
                voice = (sound["voice"] as? String)?.takeIf { it in VOICE_PACK_IDS },
            )
            if (pin == PresetSoundPin()) null else (metric as? String ?: return@mapNotNull null) to pin
        }.toMap()
    }
}

internal class AlertCoordinator(
    private val feedback: () -> AlertFeedback,
    /** Test feedback must not start a system vibration that cannot be cancelled per source. */
    private val vibrateSingles: Boolean = true,
) {
    // @parity /modules/vescape-core/ios/alerts/AlertCoordinator.swift
    var unitSystem: String = "metric"
    private val engine = AlertEngine()
    private var rules: List<AlertRuleEntity> = emptyList()
    private var pins: Map<String, PresetSoundPin> = emptyMap()
    private var activeGeigerRuleIds: Set<String> = emptySet()
    fun updateBoardConfigValues(values: Map<String, Any>) = engine.updateBoardConfigValues(values)

    fun updateMotorConfigValues(values: Map<String, Any>) = engine.updateMotorConfigValues(values)

    fun replaceRules(value: List<AlertRuleEntity>, presetPins: Map<String, PresetSoundPin> = emptyMap()) {
        val geigerRuleIds = value
            .asSequence()
            .filter { it.thresholdMax != null }
            .mapTo(mutableSetOf()) { it.id }
        for (ruleId in activeGeigerRuleIds - geigerRuleIds) {
            feedback().stopGeiger(ruleId)
        }
        activeGeigerRuleIds = activeGeigerRuleIds.intersect(geigerRuleIds)
        rules = value
        pins = presetPins
        engine.resetAlertState()
    }

    fun evaluate(
        telemetry: RefloatTelemetry,
        batteryPercent: Double?,
        onDiagnostic: (String, Map<String, Any?>) -> Unit,
    ): List<Map<String, Any?>> {
        val fired = engine.evaluate(rules, telemetry, batteryPercent)
        return deliver(
            fired = fired,
            batteryPercent = batteryPercent,
            batteryVoltage = telemetry.batteryVoltage,
            batteryCurrent = telemetry.batteryCurrent,
            onDiagnostic = onDiagnostic,
        )
    }

    /** Isolated alert tests call the same evaluator + feedback path with synthetic metric values. */
    fun evaluateValues(
        values: Map<String, Double>,
        batteryPercent: Double?,
        onDiagnostic: (String, Map<String, Any?>) -> Unit,
    ): List<Map<String, Any?>> {
        val fired = engine.evaluateValues(rules, values, batteryPercent)
        return deliver(fired, batteryPercent, values["battery"], null, onDiagnostic)
    }

    private fun deliver(
        fired: List<FiredAlert>,
        batteryPercent: Double?,
        batteryVoltage: Double?,
        batteryCurrent: Double?,
        onDiagnostic: (String, Map<String, Any?>) -> Unit,
    ): List<Map<String, Any?>> {
        for (alert in fired) {
            if (alert.controlId == "battery" && alert.rangeDepth == null) {
                onDiagnostic("battery_alert_fired", mapOf(
                    "rule_id" to alert.ruleId,
                    "used_ir_compensated_percent" to (batteryPercent != null),
                    "battery_percent" to batteryPercent,
                    "battery_voltage" to batteryVoltage,
                    "battery_current" to batteryCurrent,
                    "threshold" to alert.threshold,
                    "threshold_max" to alert.thresholdMax,
                ))
            }
        }
        val geiger = fired.filter { it.rangeDepth != null }
        val ids = geiger.mapTo(HashSet()) { it.ruleId }
        for (ruleId in activeGeigerRuleIds - ids) feedback().stopGeiger(ruleId)
        activeGeigerRuleIds = ids
        for (alert in geiger) feedback().updateGeiger(alert.ruleId, alert.soundType, alert.rangeDepth ?: 0.0, pin(alert))

        val single = fired.filter { it.rangeDepth == null }
        if (single.isNotEmpty()) {
            // Preset voice rules at Voice level Off play their severity sound only and leave the
            // spoken slot to the rest.
            val mutedPresets = if (feedback().presetVoiceEnabled) emptySet() else single.filter {
                it.ruleId.startsWith(PRESET_RULE_PREFIX) && parseVoiceAlertSound(it.soundType) != null
            }.mapTo(HashSet()) { it.ruleId }
            // One spoken announcement per evaluation: the most severe, which sorts first.
            single.firstOrNull {
                it.thresholdMax == null && isSpokenSoundType(it.soundType) && it.ruleId !in mutedPresets
            }?.let { alert ->
                val voice = parseVoiceAlertSound(alert.soundType)
                if (voice != null) {
                    feedback().speakVoice(
                        voiceAnnouncement(voice, alert.controlId, alert.threshold, batteryPercent != null, unitSystem),
                        pin = pin(alert),
                    )
                    return@let
                }
                val tts = parseTtsAlertSound(alert.soundType) ?: return@let
                val text = renderAlertMessageTemplate(tts.text, alert, batteryPercent, onDiagnostic, unitSystem)
                if (text.isNotEmpty()) feedback().speakAfterSeverity(tts.severity, text)
            }
            for (alert in single) {
                if (!isSpokenSoundType(alert.soundType)) feedback().playSingle(alert.soundType, pin(alert))
                else if (alert.ruleId in mutedPresets) {
                    feedback().playSingle("alert:${parseVoiceAlertSound(alert.soundType)!!.severity.id}", pin(alert))
                }
            }
            if (vibrateSingles) feedback().vibrate(null)
        }
        return fired.map { it.toMap() }
    }

    /** The pin of [alert]'s preset; custom rules never follow one. */
    private fun pin(alert: FiredAlert): PresetSoundPin? =
        if (alert.ruleId.startsWith(PRESET_RULE_PREFIX)) pins[alert.controlId] else null

    fun stopAllGeiger() {
        feedback().stopAllGeiger()
        activeGeigerRuleIds = emptySet()
    }
}
