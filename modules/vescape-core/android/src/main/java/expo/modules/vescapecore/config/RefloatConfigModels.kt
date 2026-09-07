package expo.modules.vescapecore.config

// @parity /modules/vescape-core/ios/config/RefloatConfigModels.swift
internal data class RefloatTuneFieldDefinition(
  val id: String,
  val label: String,
  val unitFallback: String? = null,
)

internal data class RefloatTuneGroupDefinition(
  val id: String,
  val title: String,
  val fields: List<RefloatTuneFieldDefinition>,
)

internal data class RefloatConfigField(
  val id: String,
  val label: String,
  val value: Any,
  val unit: String?,
  val min: Double?,
  val max: Double?,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "id" to id,
    "label" to label,
    "value" to value,
    "unit" to unit,
    "min" to min,
    "max" to max,
  )
}

internal data class RefloatConfigGroup(
  val id: String,
  val title: String,
  val fields: List<RefloatConfigField>,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "id" to id,
    "title" to title,
    "fields" to fields.map { it.toMap() },
  )
}

internal data class RefloatConfigSnapshot(
  val capturedAt: Long,
  val boardId: String?,
  val canId: Int?,
  val schemaHash: String,
  val rawConfigHash: String,
  val rawConfigLength: Int,
  val groups: List<RefloatConfigGroup>,
  val missingFieldIds: List<String>,
  val fwVersion: String?,
  val refloatVersion: String? = null,
  val refloatBaseVersion: String? = RefloatConfigProtocol.normalizeBaseVersion(refloatVersion),
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "capturedAt" to capturedAt,
    "boardId" to boardId,
    "canId" to canId,
    "schemaHash" to schemaHash,
    "rawConfigHash" to rawConfigHash,
    "rawConfigLength" to rawConfigLength,
    "groups" to groups.map { it.toMap() },
    "missingFieldIds" to missingFieldIds,
    "fwVersion" to fwVersion,
    "refloatVersion" to refloatVersion,
    "refloatBaseVersion" to refloatBaseVersion,
  )
}

// @parity /modules/vescape-core/ios/config/RefloatConfigModels.swift
internal enum class RefloatConfigErrorCode {
  BOARD_NOT_CONNECTED,
  LINK_NOT_TRUSTED,
  CAN_ID_UNAVAILABLE,
  GATT_NOT_WRITABLE,
  CONFIG_REQUEST_IN_FLIGHT,
  CONFIG_SCHEMA_TIMEOUT,
  CONFIG_READ_TIMEOUT,
  CONFIG_READ_FAILED,
  CONFIG_WRITE_TIMEOUT,
  CONFIG_WRITE_FAILED,
  CONFIG_VERIFY_FAILED,
  UNEXPECTED_CONFIG_RESPONSE,
  UNSUPPORTED_SCHEMA,
  CONFIG_DECODE_FAILED,
  CONFIG_ENCODE_FAILED,
  PROFILE_NOT_FOUND,
  PROFILE_BOARD_MISMATCH,
  UNSUPPORTED_PLATFORM,
}

internal val REFLOAT_TUNE_GROUPS = listOf(
  RefloatTuneGroupDefinition(
    id = "general",
    title = "General",
    fields = listOf(
      RefloatTuneFieldDefinition("kp", "Angle P"),
      RefloatTuneFieldDefinition("kp2", "Rate P"),
      RefloatTuneFieldDefinition("kp_brake", "Angle P (Braking)", "x"),
      RefloatTuneFieldDefinition("kp2_brake", "Rate P (Braking)", "x"),
      RefloatTuneFieldDefinition("ki", "Angle I"),
      RefloatTuneFieldDefinition("ki_limit", "I Term Limit", "A"),
      RefloatTuneFieldDefinition("mahony_kp", "Pitch KP"),
      RefloatTuneFieldDefinition("mahony_kp_roll", "Roll KP"),
    ),
  ),
  RefloatTuneGroupDefinition(
    id = "atr",
    title = "ATR",
    fields = listOf(
      RefloatTuneFieldDefinition("atr_strength_up", "ATR Uphill Strength"),
      RefloatTuneFieldDefinition("atr_strength_down", "ATR Downhill Strength"),
      RefloatTuneFieldDefinition("atr_threshold_up", "Threshold Angle Up", "deg"),
      RefloatTuneFieldDefinition("atr_threshold_down", "Threshold Angle Down", "deg"),
      RefloatTuneFieldDefinition("atr_speed_boost", "Speed Boost", "%"),
      RefloatTuneFieldDefinition("atr_angle_limit", "Tiltback Angle Limit", "deg"),
      RefloatTuneFieldDefinition("atr_on_speed", "Max Tiltback Speed", "deg/s"),
      RefloatTuneFieldDefinition("atr_off_speed", "Max Tiltback Release Speed", "deg/s"),
      RefloatTuneFieldDefinition("atr_response_boost", "Tiltback Response Boost", "x"),
      RefloatTuneFieldDefinition("atr_transition_boost", "Tiltback Transition Boost", "x"),
      RefloatTuneFieldDefinition("atr_filter", "Current Filter", "Hz"),
      RefloatTuneFieldDefinition("atr_amps_accel_ratio", "Amps to Acceleration Ratio"),
      RefloatTuneFieldDefinition("atr_amps_decel_ratio", "Amps to Deceleration Ratio"),
    ),
  ),
  RefloatTuneGroupDefinition(
    id = "turn_tiltback",
    title = "Turn tiltback",
    fields = listOf(
      RefloatTuneFieldDefinition("turntilt_strength", "Strength"),
      RefloatTuneFieldDefinition("turntilt_angle_limit", "Tiltback Angle Limit", "deg"),
      RefloatTuneFieldDefinition("turntilt_start_angle", "Turn Aggregate Threshold", "deg"),
      RefloatTuneFieldDefinition("turntilt_start_erpm", "ERPM Threshold", "ERPM"),
      RefloatTuneFieldDefinition("turntilt_speed", "Max Tiltback Speed", "deg/s"),
      RefloatTuneFieldDefinition("turntilt_erpm_boost", "Speed Boost %", "%"),
      RefloatTuneFieldDefinition("turntilt_erpm_boost_end", "Speed Boost Max ERPM", "ERPM"),
      RefloatTuneFieldDefinition("turntilt_yaw_aggregate", "Turn Aggregate Target", "deg"),
    ),
  ),
  RefloatTuneGroupDefinition(
    id = "torque_tiltback",
    title = "Torque tiltback",
    fields = listOf(
      RefloatTuneFieldDefinition("torquetilt_strength", "Strength", "deg/A"),
      RefloatTuneFieldDefinition("torquetilt_strength_regen", "Strength (Regen)", "deg/A"),
      RefloatTuneFieldDefinition("torquetilt_start_current", "Start Current Threshold", "A"),
      RefloatTuneFieldDefinition("torquetilt_angle_limit", "Tiltback Angle Limit", "deg"),
      RefloatTuneFieldDefinition("torquetilt_on_speed", "Max Tiltback Speed", "deg/s"),
      RefloatTuneFieldDefinition("torquetilt_off_speed", "Max Tiltback Release Speed", "deg/s"),
    ),
  ),
  RefloatTuneGroupDefinition(
    id = "brake",
    title = "Brake",
    fields = listOf(
      RefloatTuneFieldDefinition("braketilt_strength", "Brake Tilt Strength"),
      RefloatTuneFieldDefinition("braketilt_lingering", "Brake Tilt Lingering"),
    ),
  ),
  RefloatTuneGroupDefinition(
    id = "tiltback",
    title = "Tiltback",
    fields = listOf(
      RefloatTuneFieldDefinition("tiltback_constant", "Constant Tiltback", "deg"),
      RefloatTuneFieldDefinition("tiltback_constant_erpm", "Constant Tiltback ERPM", "ERPM"),
      RefloatTuneFieldDefinition("tiltback_variable", "Variable Tiltback Rate", "deg/1000 ERPM"),
      RefloatTuneFieldDefinition("tiltback_variable_max", "Variable Tiltback Target", "deg"),
      RefloatTuneFieldDefinition("tiltback_variable_erpm", "Variable Tiltback Start ERPM", "ERPM"),
    ),
  ),
)
