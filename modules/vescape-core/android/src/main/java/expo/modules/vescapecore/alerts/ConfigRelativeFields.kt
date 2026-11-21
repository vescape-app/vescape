package expo.modules.vescapecore.alerts

/**
 * @parity /src/modules/alerts/lib/configRelativeFields.ts
 * @parity /modules/vescape-core/ios/alerts/ConfigRelativeFields.swift
 */
internal enum class BoardConfigSource { REFLOAT, MOTOR }

internal data class ConfigRelativeField(
    val source: BoardConfigSource,
    val scale: Double,
    val disabledAtOrAbove: Double?,
)

internal val configRelativeFields: Map<String, ConfigRelativeField> = mapOf(
    "tiltback_duty" to ConfigRelativeField(BoardConfigSource.REFLOAT, 100.0, 1.0),
    "l_temp_fet_start" to ConfigRelativeField(BoardConfigSource.MOTOR, 1.0, null),
    "l_temp_motor_start" to ConfigRelativeField(BoardConfigSource.MOTOR, 1.0, null),
)

/**
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
