package expo.modules.vescapecore.telemetry

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import expo.modules.vescapecore.alerts.ALERT_BEEP_COUNT_DEFAULT

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
    Index(value = ["recording_id", "captured_at_ms"]),
  ],
)
data class TelemetryFrameEntity(
  @androidx.room.PrimaryKey(autoGenerate = true)
  val id: Long = 0,
  @ColumnInfo(name = "captured_at_ms")
  val capturedAtMs: Long,
  @ColumnInfo(name = "elapsed_realtime_ms")
  val elapsedRealtimeMs: Long,
  /**
   * Owning Board (`boards.id`), or null when the samples match no saved Board. Never the BLE
   * identifier: it is nullable, it moves when a Board is re-linked, and it is not an identity
   * (ADR 0028). The Board name is resolved from `boards` on read, never denormalized here.
   */
  @ColumnInfo(name = "board_id")
  val boardId: String?,
  /**
   * Owning Ride Recording (`ride_recordings.id`), or null for rows recorded before durable
   * recording identity existed. Board attribution and recording identity are separate facts: one
   * Board produces many recordings, and two of them can share a minute (ADR 0038).
   */
  @ColumnInfo(name = "recording_id")
  val recordingId: String? = null,
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
 * One **Ride Recording**: durable identity and explicit start/end boundaries for a capture, held
 * apart from the Board that produced it (ADR 0038).
 *
 * `board_id` stays Board attribution — it says *which Board*, never *which recording*. Two
 * recordings of one Board minutes (or seconds) apart are two rows here, which is what keeps their
 * frames, track and minute buckets from being merged on read.
 *
 * [endedAtMs] is null while the recording is open. Only an explicit rider Stop Recording or
 * Disconnect closes it: an unexpected drop, an Idle Pause, a process restart or an hour of silence
 * in both streams leave it open.
 *
 * @parity /modules/vescape-core/ios/telemetry/RideTrackStore.swift `RideRecording`
 */
@Entity(
  tableName = "ride_recordings",
  indices = [
    Index(value = ["started_at_ms"]),
    Index(value = ["board_id", "started_at_ms"]),
  ],
)
data class RideRecordingEntity(
  @PrimaryKey
  val id: String,
  /** Owning Board (`boards.id`), or null when the recording matched no saved Board. */
  @ColumnInfo(name = "board_id")
  val boardId: String?,
  @ColumnInfo(name = "started_at_ms")
  val startedAtMs: Long,
  /** Null while the recording is open. */
  @ColumnInfo(name = "ended_at_ms")
  val endedAtMs: Long? = null,
  /**
   * Why the recording ended: [RIDE_RECORDING_END_STOPPED], [RIDE_RECORDING_END_DISCONNECTED] or
   * [RIDE_RECORDING_END_BOARD_CHANGE]. Null while open.
   */
  @ColumnInfo(name = "ended_reason")
  val endedReason: String? = null,
)

/** Rider stopped recording explicitly. */
const val RIDE_RECORDING_END_STOPPED = "stopped"

/** Rider disconnected the Board explicitly. */
const val RIDE_RECORDING_END_DISCONNECTED = "disconnected"

/** An explicit connection attempt to another Board ended this one, however that attempt turned out. */
const val RIDE_RECORDING_END_BOARD_CHANGE = "board_change"

/**
 * One point of a **Ride Track**: a single GPS Fix recorded during a Ride Recording, on the GPS
 * clock (ADR 0038).
 *
 * Every admitted fix is stored with the accuracy the platform reported, poor ones included — the
 * precision rule is a read-side decision, and a write-time discard is unrecoverable. The two gates
 * that do drop a fix are the Ride Recording state (Idle Pause halts both streams) and Privacy Zones
 * (ADR 0009), which must filter this stream on its own now that position no longer rides along on a
 * suppressed Telemetry Sample.
 *
 * [fixAtMs] is the GPS clock, deliberately not aligned to any telemetry frame's capture time: a fix
 * survives a board dropout, and the two streams are joined on read, not on write.
 *
 * @parity /modules/vescape-core/ios/telemetry/RideTrackStore.swift `RideTrackPoint`
 */
@Entity(
  tableName = "ride_track_points",
  indices = [
    Index(value = ["fix_at_ms"]),
    Index(value = ["board_id", "fix_at_ms"]),
    Index(value = ["recording_id", "fix_at_ms"]),
  ],
)
data class RideTrackPointEntity(
  @PrimaryKey(autoGenerate = true)
  val id: Long = 0,
  /**
   * Owning Ride Recording (`ride_recordings.id`), or null for points migrated out of
   * `telemetry_frames`, which predate durable recording identity. Legacy history keeps its
   * gap-based grouping (`rideSplitGapMinutes`) rather than having recordings invented for it.
   */
  @ColumnInfo(name = "recording_id")
  val recordingId: String?,
  /** Owning Board (`boards.id`), or null when the fix matched no saved Board (ADR 0028). */
  @ColumnInfo(name = "board_id")
  val boardId: String?,
  /** GPS clock: when the platform says the fix was taken. */
  @ColumnInfo(name = "fix_at_ms")
  val fixAtMs: Long,
  @ColumnInfo(name = "latitude_e7")
  val latitudeE7: Int,
  @ColumnInfo(name = "longitude_e7")
  val longitudeE7: Int,
  /** Reported horizontal accuracy. Stored as reported; never a filter at write time. */
  @ColumnInfo(name = "accuracy_cm")
  val accuracyCm: Int?,
  @ColumnInfo(name = "gps_speed_centi_mps")
  val gpsSpeedCentiMps: Int?,
  /** Raw platform bearing, not the derived course. */
  @ColumnInfo(name = "bearing_centi_deg")
  val bearingCentiDeg: Int?,
  @ColumnInfo(name = "altitude_cm")
  val altitudeCm: Int?,
)

/**
 * Stand-in Ride Recording id for minute buckets aggregated from rows without durable recording
 * identity. `recording_id` is part of the bucket primary key, so legacy rows need a value rather
 * than null.
 *
 * @parity /modules/vescape-core/ios/telemetry/RideTrackStore.swift `LEGACY_RIDE_RECORDING_ID`
 */
const val LEGACY_RIDE_RECORDING_ID = ""

@Entity(
  tableName = "telemetry_minute_buckets",
  primaryKeys = ["bucket_start_ms", "board_id", "recording_id"],
  indices = [Index(value = ["bucket_start_ms"])],
)
data class TelemetryMinuteBucketEntity(
  @ColumnInfo(name = "bucket_start_ms")
  val bucketStartMs: Long,
  /**
   * Owning Board (`boards.id`), or [UNKNOWN_TELEMETRY_BOARD_ID] when the samples match no saved
   * Board — the column is part of the primary key, so it cannot be null. Keyed on the Board rather
   * than the BLE identifier (ADR 0028), which is also what the server keys this table on.
   */
  @ColumnInfo(name = "board_id")
  val boardId: String,
  /**
   * Owning Ride Recording (`ride_recordings.id`), or [LEGACY_RIDE_RECORDING_ID] for buckets built
   * before durable recording identity. Part of the key so two recordings of one Board inside one
   * minute aggregate separately instead of being merged (ADR 0038).
   */
  @ColumnInfo(name = "recording_id")
  val recordingId: String = LEGACY_RIDE_RECORDING_ID,
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
)

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
  /** Owning Board (`boards.id`); null when the Marker was written with no Board connected. */
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
  /** Owning Board (`boards.id`); null when the event was recorded with no Board connected. */
  @ColumnInfo(name = "board_id")
  val boardId: String?,
  val message: String?,
  @ColumnInfo(name = "properties_json")
  val propertiesJson: String,
)

@Entity(
  tableName = "boards",
  indices = [
    Index(value = ["created_at"]),
  ],
)
data class BoardEntity(
  @PrimaryKey
  val id: String,
  val name: String,
  @ColumnInfo(name = "ble_id")
  val bleId: String?,
  @ColumnInfo(name = "created_at")
  val createdAt: Long,
  /**
   * Tombstone stamp: epoch ms of the rider's delete, null while the Board is alive. A deleted Board
   * keeps its row so Ride History can still name it; only the Board's configuration is
   * hard-deleted (ADR-0027).
   *
   * Written by the delete path only — an upsert from the bridge never authors it.
   */
  @ColumnInfo(name = "deleted_at")
  val deletedAt: Long? = null,
)

/** Projection for Ride History name resolution — see `TelemetryDao.getBoardNames`. */
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
  @ColumnInfo(name = "threshold_kind") val thresholdKind: String = "fixed",
  @ColumnInfo(name = "config_field_id") val configFieldId: String? = null,
  @ColumnInfo(name = "threshold_offset") val thresholdOffset: Double? = null,
  @ColumnInfo(name = "threshold_max_offset") val thresholdMaxOffset: Double? = null,
  val enabled: Boolean,
  @ColumnInfo(name = "sound_type")
  val soundType: String,
  @ColumnInfo(name = "created_at")
  val createdAt: Long,
  /**
   * Repeat cadence in seconds for a single-threshold rule; null is one-shot. Ignored for range
   * rules. Mirrors TS `AlertRule.repeatEverySeconds`.
   */
  @ColumnInfo(name = "repeat_every_seconds")
  val repeatEverySeconds: Long? = null,
  /** Sound repeats per announcement. Mirrors TS `AlertRule.beepCount`. */
  @ColumnInfo(name = "beep_count")
  val beepCount: Int = ALERT_BEEP_COUNT_DEFAULT,
  /**
   * Free-text provenance tag mirroring TS `AlertRule.source`: `manual` (or null) or `preset`.
   * JS authors and regenerates preset rules; native only persists the string.
   */
  val source: String?,
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
  /** Owning Board (`boards.id`). A range excludes one Board's samples, so it is never absent. */
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
 * Durable app-scoped settings. A TS/Android/iOS parity triangle — the container tag covers every
 * key; individual literals are not tagged separately (see AGENTS.md).
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
  val freeSpinMaxSpeedDeltaKmh: Double = DEFAULT_FREE_SPIN_MAX_SPEED_DELTA_KMH,
  val freeSpinStationaryBoardCapKmh: Double = DEFAULT_FREE_SPIN_STATIONARY_BOARD_CAP_KMH,
  val rideSplitGapMinutes: Int = DEFAULT_RIDE_SPLIT_GAP_MINUTES,
  val themeMode: String = "system",
  val mapStyleKey: String = "onedark",
  val satelliteOverlayEnabled: Boolean = true,
  val satelliteImageryOpacity: Double = 0.2,
  val satelliteMapImageryOpacity: Double = 1.0,
  val satelliteImagerySaturation: Double = -0.35,
  val hideTelemetryMapDetails: Boolean = true,
  val mapOrientationMode: String = "northUp",
  val historyMetricGradientsEnabled: Boolean = true,
  val historyMetricHotRanges: Map<String, Map<String, Double>> = DEFAULT_HISTORY_METRIC_HOT_RANGES,
  val socEstimateWindowSeconds: Int = 20,
  val boardMoveStrengthPercent: Int = 60,
  val connectionSoundsEnabled: Boolean = true,
  val telemetryPollRateHz: Int = 20,
  val wearPushRateHz: Int = 4,
  val wearAutoLaunchOnConnect: Boolean = true,
  val wearNavArrowEnabled: Boolean = false,
  val companionPresenceEnabled: Boolean = false,
  val boardWarningsEnabled: Boolean = true,
  /** `VESC Fault Collection` master switch — independent of [boardWarningsEnabled] (#430). */
  val vescFaultCollectionEnabled: Boolean = true,
  val companionPresenceCooldownMinutes: Int = 60,
  val autoCloseEnabled: Boolean = false,
  val autoCloseDelayMinutes: Int = 15,
  val riderId: String? = null,
  val riderName: String? = null,
  val riderColor: String? = null,
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
  @ColumnInfo(name = "refloat_base_version")
  val refloatBaseVersion: String,
  val name: String,
  val icon: String = "sliders-horizontal",
  val color: String = "purple",
  @ColumnInfo(name = "fields_json")
  val fieldsJson: String,
  @ColumnInfo(name = "created_at")
  val createdAt: Long,
  @ColumnInfo(name = "updated_at")
  val updatedAt: Long,
)

@Entity(
  tableName = "tune_history_entries",
  indices = [
    Index(value = ["profile_id"]),
    Index(value = ["created_at"]),
  ],
)
data class TuneHistoryEntryEntity(
  @PrimaryKey(autoGenerate = true)
  val id: Long = 0,
  @ColumnInfo(name = "profile_id")
  val profileId: String,
  @ColumnInfo(name = "fields_json")
  val fieldsJson: String,
  @ColumnInfo(name = "created_at")
  val createdAt: Long,
)

/**
 * One durable Board Warning row, keyed one-per-problem-kind per Board (automotive fault-code model).
 * Re-detection upserts the same row, preserving [firstDetectedAtMs] while refreshing severity,
 * [lastDetectedAtMs], and [payloadJson]. Not a time series — a "current known warnings per Board".
 *
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
 * One Favorite: a durable, optionally named time range over Ride History (ADR 0029). Identity and
 * timestamps are native-minted — JS may only supply the range and the name.
 *
 * Summary stats are denormalized at creation/update from raw Telemetry Samples (ADR 0005 style)
 * because minute buckets are too coarse for a range that cuts mid-bucket.
 *
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
  /**
   * Owning Board (`boards.id`), or null when the recorded samples match no saved Board. Never the
   * BLE peripheral id: that changes on re-link and differs per install, so it is not an identity.
   */
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
  /** Odometer delta across the range, or null when the range carries no odometer readings. */
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
   * Board name is resolved on read from `boards`, not snapshotted, so renames propagate.
   *
   * @parity /modules/vescape-core/ios/telemetry/FavoriteStore.swift `Favorite.toMap`
   */
  fun toMap(
    boardName: String?,
    routePoints: List<Map<String, Double>> = emptyList(),
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
  )
}

/**
 * One immutable Favorite Media manifest row. SQLite owns metadata; the canonical file path is
 * derived only from the Favorite and media ids plus the stored MIME type (ADR 0030).
 *
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
 * Cached Board Config Values: the last decoded Refloat config for one Board and Refloat base version,
 * restored as `lastKnown` on connect so consumers have something before this session's fresh read
 * lands (ADR 0035). Scoped like Tune Compatibility (ADR 0022) — field offsets only mean anything
 * against the firmware they were read from — and deleted for the whole Board on `mismatched` link
 * integrity.
 *
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
)

/**
 * Cached Motor Config Values: the last decoded VESC motor config for one Board and MCCONF signature,
 * restored as `lastKnown` on connect so consumers have something before this session's read lands.
 * Scoped by signature because that is the layout identity (ADR 0036), and deleted for the whole
 * Board on `mismatched` link integrity.
 *
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
 * One durable VESC Fault Occurrence: a single activation of a controller fault code on one Board.
 *
 * Board-owned truth, independent of Ride Recording, Ride History, and Board Warnings. Unlike
 * [BoardWarningEntity] this **is** a time series — the same code activating twice is two rows, so
 * the identity is a native-minted [id], never (board, code).
 *
 * Fault rows are **not** cascaded on Board removal — the evidence outlives the Board record.
 *
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
  /** Raw Refloat fault code. Canonical value — display mapping must tolerate unknown codes. */
  val code: Int,
  /** When the live activation was observed. */
  @ColumnInfo(name = "occurred_at")
  val occurredAtMs: Long,
  /** Last frame that still reported this code active. */
  @ColumnInfo(name = "last_observed_at")
  val lastObservedAtMs: Long,
  /** Set when the controller reported a clear or a different code. Null = still open/unresolved. */
  @ColumnInfo(name = "cleared_at")
  val clearedAtMs: Long?,
  /** Rider acknowledged this occurrence: stays durable, stops driving the fault icon. */
  val dismissed: Boolean,
)
/**
 * Metadata for one VESC Fault Capture: the self-contained window of decoded Board samples a single
 * VESC Fault Occurrence owns.
 *
 * Keyed by the occurrence id — one occurrence, at most one capture. Deliberately **not** part of
 * Ride History: no GPS, no telemetry frames, no minute buckets, no retention pruning. Fault evidence
 * outlives both the Board record and any recorded ride.
 *
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
  /** Intended window start: detection minus the five-second pre-roll. */
  @ColumnInfo(name = "started_at")
  val startedAtMs: Long,
  /** Detection time — the boundary between pre-roll and incident. */
  @ColumnInfo(name = "opened_at")
  val openedAtMs: Long,
  /** Samples actually retained — the achieved Board Session rate, never a fabricated cadence. */
  @ColumnInfo(name = "sample_count")
  val sampleCount: Int,
)

/**
 * One decoded Board sample inside a VESC Fault Capture. Rows are append-only and intentionally
 * duplicated across overlapping captures so each occurrence stays independently inspectable.
 *
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
