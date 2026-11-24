package expo.modules.vescapecore.database

import expo.modules.vescapecore.navigation.DEFAULT_REROUTE_DISTANCE_METERS
import expo.modules.vescapecore.weather.WEATHER_ALERT_LEVEL_DEFAULT
import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import expo.modules.vescapecore.telemetry.DEFAULT_HISTORY_METRIC_HOT_RANGES
import expo.modules.vescapecore.telemetry.DEFAULT_RIDE_SPLIT_GAP_MINUTES
import expo.modules.vescapecore.telemetry.RideWeather
import expo.modules.vescapecore.telemetry.WeatherObservation

// @parity /modules/vescape-core/ios/alerts/AlertEngine.swift
const val TELEMETRY_FLAG_KEYFRAME = 1

const val TELEMETRY_MASK_SPEED = 1
const val TELEMETRY_MASK_BATTERY_VOLTAGE = 1 shl 1
const val TELEMETRY_MASK_MOTOR_CURRENT = 1 shl 2
const val TELEMETRY_MASK_BATTERY_CURRENT = 1 shl 3
const val TELEMETRY_MASK_DUTY = 1 shl 4
const val TELEMETRY_MASK_PITCH = 1 shl 5
const val TELEMETRY_MASK_ROLL = 1 shl 6
const val TELEMETRY_MASK_BALANCE_PITCH = 1 shl 7
const val TELEMETRY_MASK_BALANCE_CURRENT = 1 shl 8
const val TELEMETRY_MASK_ERPM = 1 shl 9
const val TELEMETRY_MASK_STATE = 1 shl 10
const val TELEMETRY_MASK_SWITCH_STATE = 1 shl 11
const val TELEMETRY_MASK_ADC1 = 1 shl 12
const val TELEMETRY_MASK_ADC2 = 1 shl 13
const val TELEMETRY_MASK_ODOMETER = 1 shl 14
const val TELEMETRY_MASK_TEMP_MOSFET = 1 shl 15
const val TELEMETRY_MASK_TEMP_MOTOR = 1 shl 16

@Entity(
  tableName = "telemetry_frames",
  indices = [
    Index(value = ["captured_at_ms"]),
    Index(value = ["board_id", "captured_at_ms"]),
  ],
)
data class TelemetryFrameEntity(
  @androidx.room.PrimaryKey(autoGenerate = true)
  val id: Long = 0,
  @ColumnInfo(name = "captured_at_ms")
  val capturedAtMs: Long,
  @ColumnInfo(name = "elapsed_realtime_ms")
  val elapsedRealtimeMs: Long,
  @ColumnInfo(name = "board_id")
  val boardId: String?,
  @ColumnInfo(name = "can_id")
  val canId: Int?,
  val flags: Int,
  @ColumnInfo(name = "changed_mask_1")
  val changedMask1: Int,
  @ColumnInfo(name = "changed_mask_2")
  val changedMask2: Int,
  @ColumnInfo(name = "speed_centi_kmh")
  val speedCentiKmh: Int?,
  @ColumnInfo(name = "battery_voltage_mv")
  val batteryVoltageMv: Int?,
  @ColumnInfo(name = "motor_current_ma")
  val motorCurrentMa: Int?,
  @ColumnInfo(name = "battery_current_ma")
  val batteryCurrentMa: Int?,
  @ColumnInfo(name = "duty_permille")
  val dutyPermille: Int?,
  @ColumnInfo(name = "pitch_centi_deg")
  val pitchCentiDeg: Int?,
  @ColumnInfo(name = "roll_centi_deg")
  val rollCentiDeg: Int?,
  @ColumnInfo(name = "balance_pitch_centi_deg")
  val balancePitchCentiDeg: Int?,
  @ColumnInfo(name = "balance_current_ma")
  val balanceCurrentMa: Int?,
  val erpm: Int?,
  val state: Int?,
  @ColumnInfo(name = "switch_state")
  val switchState: Int?,
  @ColumnInfo(name = "adc1_milli")
  val adc1Milli: Int?,
  @ColumnInfo(name = "adc2_milli")
  val adc2Milli: Int?,
  @ColumnInfo(name = "odometer_cm")
  val odometerCm: Long?,
  @ColumnInfo(name = "temp_mosfet_deci_c")
  val tempMosfetDeciC: Int?,
  @ColumnInfo(name = "temp_motor_deci_c")
  val tempMotorDeciC: Int?,
)

/**
 * @parity /modules/vescape-core/ios/telemetry/TelemetryChunkStore.swift
 */
@Entity(
  tableName = "telemetry_chunks",
  indices = [
    Index(value = ["board_key", "minute_start_ms"], unique = true),
    Index(value = ["minute_start_ms"]),
  ],
  foreignKeys = [ForeignKey(entity = BoardEntity::class, parentColumns = ["key"], childColumns = ["board_key"])],
)
data class TelemetryChunkEntity(
  @PrimaryKey(autoGenerate = true)
  val id: Long = 0,
  @ColumnInfo(name = "board_key")
  val boardKey: Long?,
  @ColumnInfo(name = "minute_start_ms")
  val minuteStartMs: Long,
  @ColumnInfo(name = "codec_version")
  val codecVersion: Int,
  @ColumnInfo(name = "sample_count")
  val sampleCount: Int,
  @ColumnInfo(name = "first_at_ms")
  val firstAtMs: Long,
  @ColumnInfo(name = "last_at_ms")
  val lastAtMs: Long,
  val payload: ByteArray,
)

data class TelemetryChunkHeader(
  val id: Long,
  @ColumnInfo(name = "board_id")
  val boardId: String?,
  @ColumnInfo(name = "minute_start_ms")
  val minuteStartMs: Long,
  @ColumnInfo(name = "sample_count")
  val sampleCount: Int,
  @ColumnInfo(name = "first_at_ms")
  val firstAtMs: Long,
  @ColumnInfo(name = "last_at_ms")
  val lastAtMs: Long,
)

/**
 * @parity /modules/vescape-core/ios/telemetry/RideTrackStore.swift `RideTrackPoint`
 */
@Entity(
  tableName = "ride_track_points",
  indices = [
    Index(value = ["fix_at_ms"]),
    Index(value = ["board_key", "fix_at_ms"]),
  ],
  foreignKeys = [ForeignKey(entity = BoardEntity::class, parentColumns = ["key"], childColumns = ["board_key"])],
)
data class RideTrackPointEntity(
  @PrimaryKey(autoGenerate = true)
  val id: Long = 0,
  @ColumnInfo(name = "board_key")
  val boardKey: Long?,
  @ColumnInfo(name = "fix_at_ms")
  val fixAtMs: Long,
  @ColumnInfo(name = "latitude_e7")
  val latitudeE7: Int,
  @ColumnInfo(name = "longitude_e7")
  val longitudeE7: Int,
  @ColumnInfo(name = "accuracy_cm")
  val accuracyCm: Int?,
  @ColumnInfo(name = "gps_speed_centi_mps")
  val gpsSpeedCentiMps: Int?,
  @ColumnInfo(name = "bearing_centi_deg")
  val bearingCentiDeg: Int?,
  @ColumnInfo(name = "altitude_cm")
  val altitudeCm: Int?,
)

data class RideTrackPoint(
  val id: Long = 0,
  @ColumnInfo(name = "board_id")
  val boardId: String?,
  @ColumnInfo(name = "fix_at_ms")
  val fixAtMs: Long,
  @ColumnInfo(name = "latitude_e7")
  val latitudeE7: Int,
  @ColumnInfo(name = "longitude_e7")
  val longitudeE7: Int,
  @ColumnInfo(name = "accuracy_cm")
  val accuracyCm: Int?,
  @ColumnInfo(name = "gps_speed_centi_mps")
  val gpsSpeedCentiMps: Int?,
  @ColumnInfo(name = "bearing_centi_deg")
  val bearingCentiDeg: Int?,
  @ColumnInfo(name = "altitude_cm")
  val altitudeCm: Int?,
) {
  fun toEntity(boardKey: Long?) = RideTrackPointEntity(id, boardKey, fixAtMs, latitudeE7, longitudeE7,
    accuracyCm, gpsSpeedCentiMps, bearingCentiDeg, altitudeCm)
}

@Entity(
  tableName = "telemetry_minute_buckets",
  primaryKeys = ["bucket_start_ms", "board_id"],
  indices = [Index(value = ["bucket_start_ms"])],
)
data class TelemetryMinuteBucketEntity(
  @ColumnInfo(name = "bucket_start_ms")
  val bucketStartMs: Long,
  @ColumnInfo(name = "board_id")
  val boardId: String,
  @ColumnInfo(name = "sample_count")
  val sampleCount: Int,
  @ColumnInfo(name = "first_sample_at_ms")
  val firstSampleAtMs: Long,
  @ColumnInfo(name = "last_sample_at_ms")
  val lastSampleAtMs: Long,
  @ColumnInfo(name = "sum_abs_speed_centi_kmh")
  val sumAbsSpeedCentiKmh: Long,
  @ColumnInfo(name = "moving_speed_sample_count")
  val movingSpeedSampleCount: Int?,
  @ColumnInfo(name = "sum_moving_abs_speed_centi_kmh")
  val sumMovingAbsSpeedCentiKmh: Long?,
  @ColumnInfo(name = "max_abs_speed_centi_kmh")
  val maxAbsSpeedCentiKmh: Int,
  @ColumnInfo(name = "min_battery_voltage_mv")
  val minBatteryVoltageMv: Int?,
  @ColumnInfo(name = "max_motor_current_abs_ma")
  val maxMotorCurrentAbsMa: Int,
  @ColumnInfo(name = "max_battery_current_abs_ma")
  val maxBatteryCurrentAbsMa: Int,
  @ColumnInfo(name = "battery_used_wh_milli")
  val batteryUsedWhMilli: Long,
  @ColumnInfo(name = "battery_regen_wh_milli")
  val batteryRegenWhMilli: Long,
  @ColumnInfo(name = "max_duty_abs_permille")
  val maxDutyAbsPermille: Int,
  @ColumnInfo(name = "first_odometer_cm")
  val firstOdometerCm: Long?,
  @ColumnInfo(name = "last_odometer_cm")
  val lastOdometerCm: Long?,
  @ColumnInfo(name = "gps_point_count")
  val gpsPointCount: Int,
  @ColumnInfo(name = "precise_gps_point_count")
  val preciseGpsPointCount: Int,
  @ColumnInfo(name = "gps_distance_cm")
  val gpsDistanceCm: Long,
  @ColumnInfo(name = "max_gps_speed_centi_mps")
  val maxGpsSpeedCentiMps: Int?,
  @ColumnInfo(name = "max_temp_mosfet_deci_c")
  val maxTempMosfetDeciC: Int? = null,
  @ColumnInfo(name = "max_temp_motor_deci_c")
  val maxTempMotorDeciC: Int? = null,
  @ColumnInfo(name = "first_latitude_e7")
  val firstLatitudeE7: Int? = null,
  @ColumnInfo(name = "first_longitude_e7")
  val firstLongitudeE7: Int? = null,
  @ColumnInfo(name = "first_moving_at_ms")
  val firstMovingAtMs: Long? = null,
  @ColumnInfo(name = "last_moving_at_ms")
  val lastMovingAtMs: Long? = null,
  /** @parity /modules/vescape-core/ios/telemetry/BucketRoutePreview.swift */
  @ColumnInfo(name = "route_preview")
  val routePreview: String? = null,
)

/**
 * @parity /modules/vescape-core/ios/telemetry/RideHistoryRepository.swift `recordingStopMarker`
 * @parity /modules/vescape-core/src/index.ts `HistoryMarker`
 */
const val RECORDING_STOP_MARKER = "recording_stop"

@Entity(
  tableName = "telemetry_markers",
  indices = [
    Index(value = ["occurred_at_ms"]),
    Index(value = ["board_id", "occurred_at_ms"]),
  ],
)
data class TelemetryMarkerEntity(
  @androidx.room.PrimaryKey(autoGenerate = true)
  val id: Long = 0,
  @ColumnInfo(name = "occurred_at_ms")
  val occurredAtMs: Long,
  @ColumnInfo(name = "elapsed_realtime_ms")
  val elapsedRealtimeMs: Long,
  val type: String,
  @ColumnInfo(name = "board_id")
  val boardId: String?,
  val message: String?,
  @ColumnInfo(name = "gap_ms")
  val gapMs: Long?,
)

@Entity(
  tableName = "diagnostic_events",
  indices = [
    Index(value = ["occurred_at_ms"]),
    Index(value = ["event_name"]),
    Index(value = ["board_id", "occurred_at_ms"]),
  ],
)
data class DiagnosticEventEntity(
  @androidx.room.PrimaryKey(autoGenerate = true)
  val id: Long = 0,
  @ColumnInfo(name = "occurred_at_ms")
  val occurredAtMs: Long,
  @ColumnInfo(name = "elapsed_realtime_ms")
  val elapsedRealtimeMs: Long,
  @ColumnInfo(name = "event_name")
  val eventName: String,
  val operation: String?,
  val phase: String?,
  @ColumnInfo(name = "board_id")
  val boardId: String?,
  val message: String?,
  @ColumnInfo(name = "properties_json")
  val propertiesJson: String,
)

@Entity(
  tableName = "boards",
  indices = [
    Index(value = ["id"], unique = true),
    Index(value = ["created_at"]),
  ],
)
data class BoardEntity(
  val id: String,
  val name: String,
  @ColumnInfo(name = "ble_id")
  val bleId: String?,
  @ColumnInfo(name = "created_at")
  val createdAt: Long,
  @ColumnInfo(name = "deleted_at")
  val deletedAt: Long? = null,
  @PrimaryKey(autoGenerate = true)
  val key: Long = 0,
)

data class BoardNameRow(
  val id: String,
  val name: String,
)

@Entity(
  tableName = "board_settings",
  primaryKeys = ["board_id", "key"],
  indices = [
    Index(value = ["board_id"]),
  ],
)
data class BoardSettingEntity(
  @ColumnInfo(name = "board_id")
  val boardId: String,
  val key: String,
  @ColumnInfo(name = "value_json")
  val valueJson: String,
  @ColumnInfo(name = "updated_at")
  val updatedAt: Long,
)

@Entity(
  tableName = "alerts",
  primaryKeys = ["board_id", "id"],
  indices = [
    Index(value = ["board_id"]),
    Index(value = ["control_id"]),
    Index(value = ["enabled"]),
    Index(value = ["created_at"]),
  ],
)
data class AlertRuleEntity(
  @ColumnInfo(name = "board_id")
  val boardId: String,
  val id: String,
  @ColumnInfo(name = "control_id")
  val controlId: String,
  val threshold: Double,
  @ColumnInfo(name = "threshold_max")
  val thresholdMax: Double?,
  @ColumnInfo(name = "threshold_kind", defaultValue = "fixed") val thresholdKind: String = "fixed",
  @ColumnInfo(name = "config_field_id") val configFieldId: String? = null,
  @ColumnInfo(name = "threshold_offset") val thresholdOffset: Double? = null,
  @ColumnInfo(name = "threshold_max_offset") val thresholdMaxOffset: Double? = null,
  val enabled: Boolean,
  @ColumnInfo(name = "spec")
  val spec: String,
  @ColumnInfo(name = "created_at")
  val createdAt: Long,
  @ColumnInfo(name = "repeat_every_seconds")
  val repeatEverySeconds: Long? = null,
)

@Entity(
  tableName = "metric_exclusion_ranges",
  indices = [
    Index(value = ["start_ms", "end_ms"]),
    Index(value = ["board_id", "start_ms", "end_ms"]),
  ],
)
data class MetricExclusionRangeEntity(
  @PrimaryKey(autoGenerate = true)
  val id: Long = 0,
  @ColumnInfo(name = "board_id")
  val boardId: String,
  val reason: String,
  @ColumnInfo(name = "start_ms")
  val startMs: Long,
  @ColumnInfo(name = "end_ms")
  val endMs: Long,
  @ColumnInfo(name = "sample_count")
  val sampleCount: Int,
)

@Entity(
  tableName = "privacy_zones",
)
data class PrivacyZoneEntity(
  @PrimaryKey
  val id: String,
  val preset: String,
  val name: String,
  val enabled: Boolean,
  @ColumnInfo(name = "center_latitude_e7")
  val centerLatitudeE7: Int,
  @ColumnInfo(name = "center_longitude_e7")
  val centerLongitudeE7: Int,
  @ColumnInfo(name = "radius_meters")
  val radiusMeters: Int,
  @ColumnInfo(name = "created_at")
  val createdAt: Long,
  @ColumnInfo(name = "updated_at")
  val updatedAt: Long,
)

@Entity(tableName = "app_settings")
data class AppSettingEntity(
  @PrimaryKey
  val key: String,
  @ColumnInfo(name = "value_json")
  val valueJson: String,
  @ColumnInfo(name = "updated_at")
  val updatedAt: Long,
)

/**
 * @parity /modules/vescape-core/src/index.ts `AppSettings`
 * @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `defaultSettings`
 */
data class AppSettings(
  val liveHistoryLimit: Int = 5,
  val autoConnect: Boolean = true,
  val autoRecording: Boolean = true,
  val selectedBoardId: String? = null,
  val lastGpsLatitude: Double? = null,
  val lastGpsLongitude: Double? = null,
  val directionPointLatitude: Double? = null,
  val directionPointLongitude: Double? = null,
  val movingSpeedThresholdKmh: Double = 3.0,
  val rideSplitGapMinutes: Int = DEFAULT_RIDE_SPLIT_GAP_MINUTES,
  val distanceUnit: String = "km",
  val temperatureUnit: String = "celsius",
  val timeFormat: String = "24h",
  val dateFormat: String = "dmy",
  val themeMode: String = "system",
  val mapStyleKey: String = "onedark",
  val satelliteOverlayEnabled: Boolean = true,
  val satelliteImageryOpacity: Double = 0.2,
  val satelliteMapImageryOpacity: Double = 1.0,
  val satelliteImagerySaturation: Double = -0.35,
  val hideTelemetryMapDetails: Boolean = true,
  val showHistoryMapMarkers: Boolean = false,
  val navigationRerouteDistanceMeters: Double = DEFAULT_REROUTE_DISTANCE_METERS,
  val mapOrientationMode: String = "northUp",
  val historyMetricGradientsEnabled: Boolean = true,
  val historyMetricHotRanges: Map<String, Map<String, Double>> = DEFAULT_HISTORY_METRIC_HOT_RANGES,
  val socEstimateWindowSeconds: Int = 20,
  val boardMoveStrengthPercent: Int = 60,
  val connectionSoundsEnabled: Boolean = true,
  val soundPack: String = "arc",
  // @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `defaultSettings`
  // @parity /modules/vescape-core/src/index.ts `AppSettings`
  val audioSource: String = "alarm",
  /** @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `defaultSettings` */
  val voice: String = "matching",
  /** @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `defaultSettings` */
  val voiceLevel: String = "standard",
  /** @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `defaultSettings` */
  val weatherRainAlertLevel: String = WEATHER_ALERT_LEVEL_DEFAULT,
  val weatherWindAlertLevel: String = WEATHER_ALERT_LEVEL_DEFAULT,
  val telemetryPollRateHz: Int = 20,
  val wearPushRateHz: Int = 4,
  val wearAutoLaunchOnConnect: Boolean = true,
  val wearNavArrowEnabled: Boolean = false,
  val wearTelemetryTrailEnabled: Boolean = true,
  val wearTelemetryGroupEnabled: Boolean = true,
  val wearTelemetryRouteEnabled: Boolean = true,
  val wearStreetMapEnabled: Boolean = true,
  val wearMapGaugesPercent: Int = 60,
  val wearTiltRatePercent: Int = 20,
  val companionPresenceEnabled: Boolean = false,
  val boardWarningsEnabled: Boolean = true,
  val vescFaultCollectionEnabled: Boolean = true,
  val companionPresenceCooldownMinutes: Int = 60,
  val autoCloseEnabled: Boolean = false,
  val autoCloseDelayMinutes: Int = 15,
  val legalPolicy: Map<String, String>? = null,
  val dismissedCommunityMessageIds: List<String> = emptyList(),
)

@Entity(
  tableName = "tune_profiles",
  indices = [
    Index(value = ["board_id"]),
    Index(value = ["board_id", "refloat_base_version"]),
  ],
)
data class TuneProfileEntity(
  @PrimaryKey
  val id: String,
  @ColumnInfo(name = "board_id")
  val boardId: String,
  @ColumnInfo(name = "refloat_base_version", defaultValue = "")
  val refloatBaseVersion: String,
  val name: String,
  @ColumnInfo(defaultValue = "sliders-horizontal")
  val icon: String = "sliders-horizontal",
  @ColumnInfo(defaultValue = "purple")
  val color: String = "purple",
  @ColumnInfo(name = "fields_json")
  val fieldsJson: String,
  @ColumnInfo(name = "created_at")
  val createdAt: Long,
  @ColumnInfo(name = "updated_at")
  val updatedAt: Long,
)

/**
 * @parity /modules/vescape-core/ios/warnings/BoardWarningStore.swift
 */
@Entity(
  tableName = "board_warnings",
  primaryKeys = ["board_id", "kind"],
  indices = [
    Index(value = ["board_id"]),
  ],
)
data class BoardWarningEntity(
  @ColumnInfo(name = "board_id")
  val boardId: String,
  val kind: String,
  val severity: String,
  @ColumnInfo(name = "first_detected_at")
  val firstDetectedAt: Long,
  @ColumnInfo(name = "last_detected_at")
  val lastDetectedAt: Long,
  @ColumnInfo(name = "payload_json")
  val payloadJson: String,
)

/**
 * @parity /modules/vescape-core/ios/telemetry/FavoriteStore.swift `Favorite`
 * @parity /modules/vescape-core/src/index.ts `Favorite`
 */
@Entity(
  tableName = "favorites",
  indices = [
    Index(value = ["start_ms", "end_ms"]),
    Index(value = ["board_id"]),
  ],
)
data class FavoriteEntity(
  @PrimaryKey
  val id: String,
  @ColumnInfo(name = "board_id")
  val boardId: String?,
  val name: String?,
  @ColumnInfo(name = "start_ms")
  val startMs: Long,
  @ColumnInfo(name = "end_ms")
  val endMs: Long,
  @ColumnInfo(name = "created_at")
  val createdAt: Long,
  @ColumnInfo(name = "updated_at")
  val updatedAt: Long,
  @ColumnInfo(name = "sample_count")
  val sampleCount: Int,
  @ColumnInfo(name = "gps_point_count")
  val gpsPointCount: Int,
  @ColumnInfo(name = "distance_cm")
  val distanceCm: Long?,
  @ColumnInfo(name = "moving_duration_ms")
  val movingDurationMs: Long,
  @ColumnInfo(name = "avg_speed_centi_kmh")
  val avgSpeedCentiKmh: Int,
  @ColumnInfo(name = "max_speed_centi_kmh")
  val maxSpeedCentiKmh: Int,
  @ColumnInfo(name = "battery_used_wh_milli")
  val batteryUsedWhMilli: Long,
) {
  /**
   * @parity /modules/vescape-core/ios/telemetry/FavoriteStore.swift `Favorite.toMap`
   */
  fun toMap(
    boardName: String?,
    routePoints: List<Map<String, Any>> = emptyList(),
    weather: RideWeather? = null,
  ): Map<String, Any?> = mapOf(
    "id" to id,
    "boardId" to boardId,
    "boardName" to boardName,
    "name" to name,
    "startMs" to startMs,
    "endMs" to endMs,
    "createdAtMs" to createdAt,
    "updatedAtMs" to updatedAt,
    "sampleCount" to sampleCount,
    "gpsPointCount" to gpsPointCount,
    "distanceM" to distanceCm?.let { it / 100.0 },
    "movingDurationMs" to movingDurationMs,
    "avgSpeedKmh" to avgSpeedCentiKmh / 100.0,
    "maxSpeedKmh" to maxSpeedCentiKmh / 100.0,
    "batteryUsedWh" to batteryUsedWhMilli / 1000.0,
    "routePoints" to routePoints,
    "weather" to weather?.toMap(),
  )
}

/**
 * @parity /modules/vescape-core/ios/telemetry/FavoriteMediaStore.swift `FavoriteMedia`
 * @parity /modules/vescape-core/src/index.ts `FavoriteMedia`
 */
@Entity(
  tableName = "favorite_media",
  indices = [
    Index(value = ["favorite_id", "created_at"]),
  ],
)
data class FavoriteMediaEntity(
  @PrimaryKey
  val id: String,
  @ColumnInfo(name = "favorite_id")
  val favoriteId: String,
  @ColumnInfo(name = "captured_at")
  val capturedAt: Long?,
  @ColumnInfo(name = "mime_type")
  val mimeType: String,
  @ColumnInfo(name = "media_kind")
  val mediaKind: String,
  @ColumnInfo(name = "byte_count")
  val byteCount: Long,
  @ColumnInfo(name = "content_hash")
  val contentHash: String,
  @ColumnInfo(name = "created_at")
  val createdAt: Long,
) {
  fun toMap(uri: String, filename: String): Map<String, Any?> = mapOf(
    "id" to id,
    "favoriteId" to favoriteId,
    "capturedAtMs" to capturedAt,
    "mimeType" to mimeType,
    "mediaKind" to mediaKind,
    "byteCount" to byteCount,
    "contentHash" to contentHash,
    "createdAtMs" to createdAt,
    "uri" to uri,
    "filename" to filename,
  )
}

/**
 * @parity /modules/vescape-core/ios/config/BoardConfigStore.swift
 */
@Entity(
  tableName = "board_config_values",
  primaryKeys = ["board_id", "refloat_base_version"],
  indices = [
    Index(value = ["board_id"]),
  ],
)
data class BoardConfigValuesEntity(
  @ColumnInfo(name = "board_id")
  val boardId: String,
  @ColumnInfo(name = "refloat_base_version")
  val refloatBaseVersion: String,
  @ColumnInfo(name = "values_json")
  val valuesJson: String,
  @ColumnInfo(name = "captured_at")
  val capturedAt: Long,
  @ColumnInfo(name = "schema_hash")
  val schemaHash: String? = null,
)

/**
 * @parity /modules/vescape-core/ios/config/BoardConfigStore.swift `BoardConfigSchemaRecord`
 */
@Entity(tableName = "board_config_schemas")
data class BoardConfigSchemaEntity(
  @PrimaryKey
  @ColumnInfo(name = "schema_hash")
  val schemaHash: String,
  @ColumnInfo(name = "raw_xml")
  val rawXml: String,
  @ColumnInfo(name = "created_at")
  val createdAt: Long,
)

/**
 * @parity /modules/vescape-core/ios/config/BoardConfigStore.swift `BoardConfigRevisionRecord`
 */
@Entity(
  tableName = "board_config_revisions",
  indices = [
    Index(value = ["board_id", "created_at"]),
    Index(value = ["schema_hash"]),
  ],
  foreignKeys = [
    ForeignKey(
      entity = BoardConfigSchemaEntity::class,
      parentColumns = ["schema_hash"],
      childColumns = ["schema_hash"],
      onUpdate = ForeignKey.NO_ACTION,
      onDelete = ForeignKey.NO_ACTION,
    ),
  ],
)
data class BoardConfigRevisionEntity(
  @PrimaryKey(autoGenerate = true)
  val id: Long = 0,
  @ColumnInfo(name = "board_id")
  val boardId: String,
  @ColumnInfo(name = "refloat_version")
  val refloatVersion: String,
  @ColumnInfo(name = "schema_hash")
  val schemaHash: String,
  @ColumnInfo(name = "package_signature")
  val packageSignature: Long,
  @ColumnInfo(name = "raw_config")
  val rawConfig: ByteArray,
  val source: String,
  @ColumnInfo(name = "changes_json")
  val changesJson: String,
  @ColumnInfo(name = "tune_profile_id")
  val tuneProfileId: String? = null,
  @ColumnInfo(name = "created_at")
  val createdAt: Long,
) {
  override fun equals(other: Any?): Boolean {
    if (this === other) return true
    if (other !is BoardConfigRevisionEntity) return false
    return id == other.id &&
      boardId == other.boardId &&
      refloatVersion == other.refloatVersion &&
      schemaHash == other.schemaHash &&
      packageSignature == other.packageSignature &&
      rawConfig.contentEquals(other.rawConfig) &&
      source == other.source &&
      changesJson == other.changesJson &&
      tuneProfileId == other.tuneProfileId &&
      createdAt == other.createdAt
  }

  override fun hashCode(): Int {
    var result = id.hashCode()
    result = 31 * result + boardId.hashCode()
    result = 31 * result + refloatVersion.hashCode()
    result = 31 * result + schemaHash.hashCode()
    result = 31 * result + packageSignature.hashCode()
    result = 31 * result + rawConfig.contentHashCode()
    result = 31 * result + source.hashCode()
    result = 31 * result + changesJson.hashCode()
    result = 31 * result + (tuneProfileId?.hashCode() ?: 0)
    result = 31 * result + createdAt.hashCode()
    return result
  }
}

/**
 * @parity /modules/vescape-core/ios/config/MotorConfigStore.swift
 */
@Entity(
  tableName = "motor_config_values",
  primaryKeys = ["board_id", "mcconf_signature"],
  indices = [
    Index(value = ["board_id"]),
  ],
)
data class MotorConfigValuesEntity(
  @ColumnInfo(name = "board_id")
  val boardId: String,
  @ColumnInfo(name = "mcconf_signature")
  val mcconfSignature: Long,
  @ColumnInfo(name = "firmware")
  val firmware: String,
  @ColumnInfo(name = "values_json")
  val valuesJson: String,
  @ColumnInfo(name = "captured_at")
  val capturedAt: Long,
)

@Entity(tableName = "board_config_change_notices")
data class BoardConfigChangeNoticeEntity(
  @PrimaryKey @ColumnInfo(name = "board_id") val boardId: String,
  @ColumnInfo(name = "detected_at") val detectedAt: Long,
  @ColumnInfo(name = "diffs_json") val diffsJson: String,
)

/**
 * @parity /modules/vescape-core/ios/faults/VescFaultStore.swift
 */
@Entity(
  tableName = "vesc_fault_occurrences",
  indices = [
    Index(value = ["board_id", "occurred_at"]),
  ],
)
data class VescFaultOccurrenceEntity(
  @PrimaryKey
  val id: String,
  @ColumnInfo(name = "board_id")
  val boardId: String,
  val code: Int,
  @ColumnInfo(name = "occurred_at")
  val occurredAtMs: Long,
  @ColumnInfo(name = "last_observed_at")
  val lastObservedAtMs: Long,
  @ColumnInfo(name = "cleared_at")
  val clearedAtMs: Long?,
  val dismissed: Boolean,
)
/**
 * @parity /modules/vescape-core/ios/faults/VescFaultCaptureStore.swift `createTables`
 */
@Entity(
  tableName = "vesc_fault_captures",
  indices = [
    Index(value = ["board_id"]),
  ],
)
data class VescFaultCaptureEntity(
  @PrimaryKey
  @ColumnInfo(name = "occurrence_id")
  val occurrenceId: String,
  @ColumnInfo(name = "board_id")
  val boardId: String,
  @ColumnInfo(name = "started_at")
  val startedAtMs: Long,
  @ColumnInfo(name = "opened_at")
  val openedAtMs: Long,
  @ColumnInfo(name = "sample_count")
  val sampleCount: Int,
)

/**
 * @parity /modules/vescape-core/ios/faults/VescFaultCaptureStore.swift `createTables`
 */
@Entity(
  tableName = "vesc_fault_capture_samples",
  indices = [
    Index(value = ["occurrence_id", "captured_at"]),
  ],
)
data class VescFaultCaptureSampleEntity(
  @PrimaryKey(autoGenerate = true)
  val id: Long = 0,
  @ColumnInfo(name = "occurrence_id")
  val occurrenceId: String,
  @ColumnInfo(name = "captured_at")
  val capturedAtMs: Long,
  val speed: Double?,
  @ColumnInfo(name = "duty_cycle")
  val dutyCycle: Double?,
  val erpm: Double?,
  @ColumnInfo(name = "battery_voltage")
  val batteryVoltage: Double?,
  @ColumnInfo(name = "battery_current")
  val batteryCurrent: Double?,
  @ColumnInfo(name = "motor_current")
  val motorCurrent: Double?,
  @ColumnInfo(name = "temp_mosfet")
  val tempMosfet: Double?,
  @ColumnInfo(name = "temp_motor")
  val tempMotor: Double?,
  val pitch: Double?,
  val roll: Double?,
  @ColumnInfo(name = "balance_pitch")
  val balancePitch: Double?,
  val adc1: Double?,
  val adc2: Double?,
  val state: Int?,
)

/**
 * @parity /modules/vescape-core/ios/telemetry/AccessoryPersistence.swift `SavedAccessory`
 */
@Entity(tableName = "accessories")
data class SavedAccessoryEntity(
  @PrimaryKey @ColumnInfo(name = "accessory_id") val accessoryId: String,
  val name: String,
  @ColumnInfo(name = "firmware_version") val firmwareVersion: String,
  @ColumnInfo(name = "protocol_version") val protocolVersion: Int?,
  @ColumnInfo(name = "device_id") val deviceId: String?,
  @ColumnInfo(name = "capabilities_json") val capabilitiesJson: String,
  @ColumnInfo(name = "enrolled_at") val enrolledAt: Long,
  @ColumnInfo(name = "last_connected_at") val lastConnectedAt: Long?,
)

/**
 * @parity /modules/vescape-core/ios/telemetry/AccessoryPersistence.swift `SavedGroundClearance`
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/GroundClearance.kt `GroundClearanceCalibration`
 */
@Entity(tableName = "accessory_ground_clearance", primaryKeys = ["accessory_id", "capability_id"])
data class AccessoryGroundClearanceEntity(
  @ColumnInfo(name = "accessory_id") val accessoryId: String,
  @ColumnInfo(name = "capability_id") val capabilityId: String,
  @ColumnInfo(name = "near_cm") val nearCm: Double,
  @ColumnInfo(name = "far_cm") val farCm: Double,
  val direction: String,
  @ColumnInfo(name = "strength_percent") val strengthPercent: Int,
  @ColumnInfo(name = "updated_at") val updatedAt: Long,
)

/** @parity /modules/vescape-core/ios/telemetry/AccessoryPersistence.swift `SavedBrakeLight` */
@Entity(tableName = "accessory_brake_light", primaryKeys = ["accessory_id", "capability_id"])
data class AccessoryBrakeLightEntity(
 @ColumnInfo(name = "accessory_id") val accessoryId: String,
 @ColumnInfo(name = "capability_id") val capabilityId: String,
 val sensitivity: Int,
 val parked: String,
)

/** @parity /modules/vescape-core/ios/telemetry/AccessoryPersistence.swift `SavedAccessoryCapabilitySettings` */
@Entity(tableName = "accessory_capability_settings", primaryKeys = ["accessory_id", "capability_id"])
data class AccessoryCapabilitySettingsEntity(
  @ColumnInfo(name = "accessory_id") val accessoryId: String,
  @ColumnInfo(name = "capability_id") val capabilityId: String,
  val enabled: Boolean,
  @ColumnInfo(name = "sampling_rate_hz") val samplingRateHz: Double? = null,
)

/**
 * @parity /modules/vescape-core/ios/database/PersistenceSchema.swift `createWeatherObservations`
 */
@Entity(tableName = "weather_observations")
data class WeatherObservationEntity(
  @PrimaryKey
  @ColumnInfo(name = "observed_at_ms")
  val observedAtMs: Long,
  @ColumnInfo(name = "temperature_c")
  val temperatureC: Int,
  @ColumnInfo(name = "weather_code")
  val weatherCode: Int,
  @ColumnInfo(name = "gust_kmh")
  val gustKmh: Int?,
  @ColumnInfo(name = "is_day")
  val isDay: Boolean,
) {
  internal fun toObservation() = WeatherObservation(observedAtMs, temperatureC, weatherCode, gustKmh, isDay)

  internal companion object {
    fun of(observation: WeatherObservation) = WeatherObservationEntity(
      observation.observedAtMs,
      observation.temperatureC,
      observation.weatherCode,
      observation.gustKmh,
      observation.isDay,
    )
  }
}
