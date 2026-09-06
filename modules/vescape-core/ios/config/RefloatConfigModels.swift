import Foundation

/// Read-side models + tune-field allowlist for the Refloat config pipeline. Values cross the bridge
/// as `[String: Any?]` bags via `toMap()`, byte-for-byte the same shape as Android's `toMap()` so JS
/// handles both platforms identically (#171).
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatConfigModels.kt
struct RefloatTuneFieldDefinition {
  let id: String
  let label: String
  let unitFallback: String?

  init(_ id: String, _ label: String, _ unitFallback: String? = nil) {
    self.id = id
    self.label = label
    self.unitFallback = unitFallback
  }
}

struct RefloatTuneGroupDefinition {
  let id: String
  let title: String
  let fields: [RefloatTuneFieldDefinition]
}

struct RefloatConfigField {
  let id: String
  let label: String
  let value: Any
  let unit: String?
  let min: Double?
  let max: Double?

  func toMap() -> [String: Any?] {
    [
      "id": id,
      "label": label,
      "value": value,
      "unit": unit,
      "min": min,
      "max": max,
    ]
  }
}

struct RefloatConfigGroup {
  let id: String
  let title: String
  let fields: [RefloatConfigField]

  func toMap() -> [String: Any?] {
    [
      "id": id,
      "title": title,
      "fields": fields.map { $0.toMap() },
    ]
  }
}

struct RefloatConfigSnapshot {
  let capturedAt: Int64
  let boardId: String?
  let canId: Int?
  let schemaHash: String
  let rawConfigHash: String
  let rawConfigLength: Int
  let groups: [RefloatConfigGroup]
  let missingFieldIds: [String]
  let fwVersion: String?
  let refloatVersion: String?
  let refloatBaseVersion: String?

  init(
    capturedAt: Int64,
    boardId: String?,
    canId: Int?,
    schemaHash: String,
    rawConfigHash: String,
    rawConfigLength: Int,
    groups: [RefloatConfigGroup],
    missingFieldIds: [String],
    fwVersion: String?,
    refloatVersion: String? = nil,
    refloatBaseVersion: String? = nil
  ) {
    self.capturedAt = capturedAt
    self.boardId = boardId
    self.canId = canId
    self.schemaHash = schemaHash
    self.rawConfigHash = rawConfigHash
    self.rawConfigLength = rawConfigLength
    self.groups = groups
    self.missingFieldIds = missingFieldIds
    self.fwVersion = fwVersion
    self.refloatVersion = refloatVersion
    self.refloatBaseVersion = refloatBaseVersion ?? RefloatConfigProtocol.normalizeBaseVersion(refloatVersion)
  }

  func toMap() -> [String: Any?] {
    [
      "capturedAt": capturedAt,
      "boardId": boardId,
      "canId": canId,
      "schemaHash": schemaHash,
      "rawConfigHash": rawConfigHash,
      "rawConfigLength": rawConfigLength,
      "groups": groups.map { $0.toMap() },
      "missingFieldIds": missingFieldIds,
      "fwVersion": fwVersion,
      "refloatVersion": refloatVersion,
      "refloatBaseVersion": refloatBaseVersion,
    ]
  }

  /// Flatten the decoded groups into the `{ fieldId: value }` JSON stored on a Tune Profile. Mirrors
  /// Android `RefloatConfigSnapshot.fieldsJson()` in `AppDataRepository.kt`.
  func fieldsJson() -> String {
    var object: [String: Any] = [:]
    for group in groups {
      for field in group.fields {
        object[field.id] = field.value
      }
    }
    guard
      let data = try? JSONSerialization.data(withJSONObject: object),
      let json = String(data: data, encoding: .utf8)
    else { return "{}" }
    return json
  }
}

/// Error vocabulary shared with Android so JS error handling stays identical across platforms.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/RefloatConfigModels.kt
enum RefloatConfigErrorCode: String {
  case BOARD_NOT_CONNECTED
  case LINK_NOT_TRUSTED
  case CAN_ID_UNAVAILABLE
  case GATT_NOT_WRITABLE
  case CONFIG_REQUEST_IN_FLIGHT
  case CONFIG_SCHEMA_TIMEOUT
  case CONFIG_READ_TIMEOUT
  case CONFIG_READ_FAILED
  case CONFIG_WRITE_TIMEOUT
  case CONFIG_WRITE_FAILED
  case CONFIG_VERIFY_FAILED
  case UNEXPECTED_CONFIG_RESPONSE
  case UNSUPPORTED_SCHEMA
  case CONFIG_DECODE_FAILED
  case CONFIG_ENCODE_FAILED
  case PROFILE_NOT_FOUND
  case PROFILE_BOARD_MISMATCH
  case UNSUPPORTED_PLATFORM
}

let REFLOAT_TUNE_GROUPS: [RefloatTuneGroupDefinition] = [
  RefloatTuneGroupDefinition(
    id: "general",
    title: "General",
    fields: [
      RefloatTuneFieldDefinition("kp", "Angle P"),
      RefloatTuneFieldDefinition("kp2", "Rate P"),
      RefloatTuneFieldDefinition("kp_brake", "Angle P (Braking)", "x"),
      RefloatTuneFieldDefinition("kp2_brake", "Rate P (Braking)", "x"),
      RefloatTuneFieldDefinition("ki", "Angle I"),
      RefloatTuneFieldDefinition("ki_limit", "I Term Limit", "A"),
      RefloatTuneFieldDefinition("mahony_kp", "Pitch KP"),
      RefloatTuneFieldDefinition("mahony_kp_roll", "Roll KP"),
    ]
  ),
  RefloatTuneGroupDefinition(
    id: "atr",
    title: "ATR",
    fields: [
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
    ]
  ),
  RefloatTuneGroupDefinition(
    id: "turn_tiltback",
    title: "Turn tiltback",
    fields: [
      RefloatTuneFieldDefinition("turntilt_strength", "Strength"),
      RefloatTuneFieldDefinition("turntilt_angle_limit", "Tiltback Angle Limit", "deg"),
      RefloatTuneFieldDefinition("turntilt_start_angle", "Turn Aggregate Threshold", "deg"),
      RefloatTuneFieldDefinition("turntilt_start_erpm", "ERPM Threshold", "ERPM"),
      RefloatTuneFieldDefinition("turntilt_speed", "Max Tiltback Speed", "deg/s"),
      RefloatTuneFieldDefinition("turntilt_erpm_boost", "Speed Boost %", "%"),
      RefloatTuneFieldDefinition("turntilt_erpm_boost_end", "Speed Boost Max ERPM", "ERPM"),
      RefloatTuneFieldDefinition("turntilt_yaw_aggregate", "Turn Aggregate Target", "deg"),
    ]
  ),
  RefloatTuneGroupDefinition(
    id: "torque_tiltback",
    title: "Torque tiltback",
    fields: [
      RefloatTuneFieldDefinition("torquetilt_strength", "Strength", "deg/A"),
      RefloatTuneFieldDefinition("torquetilt_strength_regen", "Strength (Regen)", "deg/A"),
      RefloatTuneFieldDefinition("torquetilt_start_current", "Start Current Threshold", "A"),
      RefloatTuneFieldDefinition("torquetilt_angle_limit", "Tiltback Angle Limit", "deg"),
      RefloatTuneFieldDefinition("torquetilt_on_speed", "Max Tiltback Speed", "deg/s"),
      RefloatTuneFieldDefinition("torquetilt_off_speed", "Max Tiltback Release Speed", "deg/s"),
    ]
  ),
  RefloatTuneGroupDefinition(
    id: "brake",
    title: "Brake",
    fields: [
      RefloatTuneFieldDefinition("braketilt_strength", "Brake Tilt Strength"),
      RefloatTuneFieldDefinition("braketilt_lingering", "Brake Tilt Lingering"),
    ]
  ),
  RefloatTuneGroupDefinition(
    id: "tiltback",
    title: "Tiltback",
    fields: [
      RefloatTuneFieldDefinition("tiltback_constant", "Constant Tiltback", "deg"),
      RefloatTuneFieldDefinition("tiltback_variable", "Variable Tiltback Rate", "deg/1000 ERPM"),
      RefloatTuneFieldDefinition("tiltback_variable_max", "Variable Tiltback Target", "deg"),
    ]
  ),
]
