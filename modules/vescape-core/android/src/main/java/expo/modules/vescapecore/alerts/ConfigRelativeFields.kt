package expo.modules.vescapecore.alerts

/**
 * The board config fields an Alert Rule can anchor itself to, and what each one means.
 *
 * A config-relative rule stores only a field id and an offset (ADR 0035): the relationship is the
 * durable truth, and the threshold is resolved against whatever the board currently reports.
 * Resolving needs two things the field id alone does not carry — which config the field lives in
 * and what units it is in — so they live here rather than on every rule. They are properties of the
 * VESC/Refloat field itself, not of the rider's rule.
 *
 * @parity /src/modules/alerts/lib/configRelativeFields.ts
 * @parity /modules/vescape-core/ios/alerts/ConfigRelativeFields.swift
 */
internal enum class BoardConfigSource { REFLOAT, MOTOR }

internal data class ConfigRelativeField(
    val source: BoardConfigSource,
    /** Multiplier taking the stored value into the metric's own units (duty 0.9 -> 90%). */
    val scale: Double,
    /**
     * The stored value at or above which the board's own protection is off — VESC treats a duty
     * pushback of 1.0 as "never push back". Rules anchored to a disabled field stay dormant rather
     * than resolving to a threshold the board will never act on. Null: no such sentinel.
     */
    val disabledAtOrAbove: Double?,
)

internal val configRelativeFields: Map<String, ConfigRelativeField> = mapOf(
    "tiltback_duty" to ConfigRelativeField(BoardConfigSource.REFLOAT, 100.0, 1.0),
    "l_temp_fet_start" to ConfigRelativeField(BoardConfigSource.MOTOR, 1.0, null),
    "l_temp_motor_start" to ConfigRelativeField(BoardConfigSource.MOTOR, 1.0, null),
)

/**
 * The field's current value in the metric's units, or null when it cannot anchor a rule — the
 * config was never read, the field is missing from this firmware's layout, or the board has that
 * protection switched off.
 *
 * @parity /src/modules/alerts/lib/configRelativeFields.ts `resolveConfigRelativeBase`
 */
internal fun resolveConfigRelativeBase(
    fieldId: String?,
    refloat: Map<String, Any>,
    motor: Map<String, Any>,
): Double? {
    val field = configRelativeFields[fieldId ?: return null] ?: return null
    val source = if (field.source == BoardConfigSource.REFLOAT) refloat else motor
    val raw = (source[fieldId] as? Number)?.toDouble() ?: return null
    if (!raw.isFinite() || raw <= 0.0) return null
    if (field.disabledAtOrAbove != null && raw >= field.disabledAtOrAbove) return null
    return raw * field.scale
}
