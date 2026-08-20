package expo.modules.vescapecore.alerts

import expo.modules.vescapecore.protocol.RefloatTelemetry

import expo.modules.vescapecore.telemetry.AlertRuleEntity

internal class AlertCoordinator(
    private val feedback: () -> AlertFeedback,
    /** Test feedback must not start a system vibration that cannot be cancelled per source. */
    private val vibrateSingles: Boolean = true,
) {
    // @parity /modules/vescape-core/ios/alerts/AlertCoordinator.swift
    private val engine = AlertEngine()
    private var rules: List<AlertRuleEntity> = emptyList()
    private var activeGeigerRuleIds: Set<String> = emptySet()
    fun updateBoardConfigValues(values: Map<String, Any>) = engine.updateBoardConfigValues(values)

    fun replaceRules(value: List<AlertRuleEntity>) {
        val geigerRuleIds = value
            .asSequence()
            .filter { it.thresholdMax != null }
            .mapTo(mutableSetOf()) { it.id }
        for (ruleId in activeGeigerRuleIds - geigerRuleIds) {
            feedback().stopGeiger(ruleId)
        }
        activeGeigerRuleIds = activeGeigerRuleIds.intersect(geigerRuleIds)
        rules = value
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
        for (alert in geiger) feedback().updateGeiger(alert.ruleId, alert.soundType, alert.rangeDepth ?: 0.0)

        val single = fired.filter { it.rangeDepth == null }
        if (single.isNotEmpty()) {
            single.firstOrNull { it.soundType.startsWith("tts:") && it.thresholdMax == null }?.let { alert ->
                val text = renderAlertMessageTemplate(alert.soundType.removePrefix("tts:"), alert, batteryPercent, onDiagnostic)
                if (text.isNotEmpty()) feedback().speakMessage(text)
            }
            for (alert in single) if (!alert.soundType.startsWith("tts:")) feedback().playSingle(alert.soundType, alert.beepCount)
            if (vibrateSingles) feedback().vibrate(null)
        }
        return fired.map { it.toMap() }
    }

    fun stopAllGeiger() {
        feedback().stopAllGeiger()
        activeGeigerRuleIds = emptySet()
    }
}
