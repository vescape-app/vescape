package expo.modules.vescapecore.telemetry

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import expo.modules.vescapecore.alerts.ALERT_BEEP_COUNT_DEFAULT

// @parity /modules/vescape-core/ios/alerts/AlertEngine.swift
const val TELEMETRY_FLAG_KEYFRAME = 1
const val TELEMETRY_FLAG_HAS_LOCATION = 1 shl 2

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

const val TELEMETRY_MASK2_LOCATION = 1

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
  /**
   * Owning Board (`boards.id`), or null when the samples match no saved Board. Never the BLE
   * identifier: it is nullable, it moves when a Board is re-linked, and it is not an identity
   * (ADR 0028). The Board name is resolved from `boards` on read, never denormalized here.
   */
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
  @ColumnInfo(name = "latitude_e7")
  val latitudeE7: Int?,
  @ColumnInfo(name = "longitude_e7")
  val longitudeE7: Int?,
  @ColumnInfo(name = "gps_speed_centi_mps")
  val gpsSpeedCentiMps: Int?,
  @ColumnInfo(name = "bearing_centi_deg")
  val bearingCentiDeg: Int?,
  @ColumnInfo(name = "accuracy_cm")
  val accuracyCm: Int?,
  @ColumnInfo(name = "altitude_cm")
  val altitudeCm: Int?,
  @ColumnInfo(name = "location_timestamp_ms")
  val locationTimestampMs: Long?,
)

@Entity(
  tableName = "telemetry_minute_buckets",
  primaryKeys = ["bucket_start_ms", "board_id"],
  indices = [
    Index(value = ["bucket_start_ms"]),
    Index(value = ["updated_at"]),
    Index(value = ["sync_seq"]),
  ],
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
  /**
   * Last-write-wins timestamp: wall-clock epoch ms of the last write to this bucket. Distinct from
   * [lastSampleAtMs], which tracks the newest *sample* in the bucket — a merge that folds in older
   * samples, or a bucket rebuild, changes the row without moving that.
   *
   * Not the Sync Cursor column; [syncSeq] is. This one crosses the wire and decides which of two
   * writes to the same row the server keeps, so it stays a truthful wall clock.
   */
  @ColumnInfo(name = "updated_at")
  val updatedAt: Long,
  /** Device-local Sync Cursor position; see [SyncSequenceEntity]. */
  @ColumnInfo(name = "sync_seq")
  val syncSeq: Long = 0,
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
    Index(value = ["updated_at"]),
    Index(value = ["sync_seq"]),
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
   * Last-write-wins timestamp: epoch ms of the last write to this row, from the same clock as
   * [createdAt]. Equal to [createdAt] on insert and bumped on every mutation. It crosses the wire
   * and is what the server compares to decide which of two writes to this row it keeps, so it stays
   * a truthful wall clock rather than a counter.
   *
   * Ratcheted to `max(previous + 1, now)` on write. A device clock that steps backwards would
   * otherwise stamp an edit below the copy the server already holds, and the server's
   * last-write-wins guard would silently drop it. Per row, so the inflation is bounded by the
   * rewind and disappears once the wall clock passes it again.
   */
  @ColumnInfo(name = "updated_at")
  val updatedAt: Long,
  /** Device-local Sync Cursor position; see [SyncSequenceEntity]. */
  @ColumnInfo(name = "sync_seq")
  val syncSeq: Long = 0,
  /**
   * Tombstone stamp: epoch ms of the rider's delete, null while the Board is alive. A deleted Board
   * keeps its row so Ride History can still name it and the server's Board-owned foreign keys hold;
   * only the Board's configuration is hard-deleted (ADR-0027).
   *
   * Written by the delete path only — an upsert from the bridge never authors it, like [updatedAt].
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
    Index(value = ["sync_seq"]),
  ],
)
data class BoardSettingEntity(
  @ColumnInfo(name = "board_id")
  val boardId: String,
  val key: String,
  @ColumnInfo(name = "value_json")
  val valueJson: String,
  /** Ratcheted last-write-wins timestamp; see [BoardEntity.updatedAt]. */
  @ColumnInfo(name = "updated_at")
  val updatedAt: Long,
  /** Device-local Sync Cursor position; see [SyncSequenceEntity]. */
  @ColumnInfo(name = "sync_seq")
  val syncSeq: Long = 0,
)

@Entity(
  tableName = "alerts",
  primaryKeys = ["board_id", "id"],
  indices = [
    Index(value = ["board_id"]),
    Index(value = ["control_id"]),
    Index(value = ["enabled"]),
    Index(value = ["created_at"]),
    Index(value = ["updated_at"]),
    Index(value = ["sync_seq"]),
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
  /**
   * Last-write-wins timestamp, ratcheted on write exactly as [BoardEntity.updatedAt] is, and moved
   * by every mutation including the targeted enable/disable update.
   */
  @ColumnInfo(name = "updated_at")
  val updatedAt: Long,
  /** Device-local Sync Cursor position; see [SyncSequenceEntity]. */
  @ColumnInfo(name = "sync_seq")
  val syncSeq: Long = 0,
)

/**
 * One counter per syncable table, handing out the strictly increasing `sync_seq` those tables stamp
 * on every write.
 *
 * The Sync Cursor is the phone's own record of how far it has uploaded, and it never crosses the
 * wire — the server stores no watermark and has no opinion about one. That is what lets the scan
 * run on a counter instead of a clock: a device clock that steps backwards makes an
 * `updated_at >= watermark` scan skip the write entirely, because the row lands below a cursor the
 * phone already passed. A counter cannot regress, so the scan stays complete however the clock
 * behaves.
 *
 * The counter lives in its own table rather than being derived as `MAX(sync_seq) + 1` per table:
 * deleting the highest row would hand the same number out twice, and the second row would fall on
 * the wrong side of a cursor already advanced past it.
 */
@Entity(tableName = "sync_sequences")
data class SyncSequenceEntity(
  @PrimaryKey
  val name: String,
  @ColumnInfo(name = "last_value")
  val lastValue: Long,
)

/** Table names used as [SyncSequenceEntity] keys. */
internal const val SYNC_SEQ_BOARDS = "boards"
internal const val SYNC_SEQ_ALERTS = "alerts"
internal const val SYNC_SEQ_MINUTE_BUCKETS = "telemetry_minute_buckets"
internal const val SYNC_SEQ_APP_SETTINGS = "app_settings"
internal const val SYNC_SEQ_BOARD_SETTINGS = "board_settings"
internal const val SYNC_SEQ_BOARD_WARNINGS = "board_warnings"
internal const val SYNC_SEQ_PRIVACY_ZONES = "privacy_zones"
internal const val SYNC_SEQ_TUNE_PROFILES = "tune_profiles"
internal const val SYNC_SEQ_FAVORITES = "favorites"

/**
 * The three tables the schema-44 migration gave a `sync_seq`, frozen at the set that existed then.
 * A migration iterates the tables it actually shipped with, never the current [SYNC_SEQ_TABLES] —
 * growing that list must not retroactively change what an older migration step does.
 */
internal val SYNC_SEQ_TABLES_V43 = listOf(
  SYNC_SEQ_BOARDS,
  SYNC_SEQ_ALERTS,
  SYNC_SEQ_MINUTE_BUCKETS,
)

/** The six remaining mutable tables, given a `sync_seq` at schema 45 (#281). */
internal val SYNC_SEQ_TABLES_V44 = listOf(
  SYNC_SEQ_APP_SETTINGS,
  SYNC_SEQ_BOARD_SETTINGS,
  SYNC_SEQ_BOARD_WARNINGS,
  SYNC_SEQ_PRIVACY_ZONES,
  SYNC_SEQ_TUNE_PROFILES,
  SYNC_SEQ_FAVORITES,
)

/**
 * Every table carrying a `sync_seq`. Append-only tables are deliberately absent: they declare
 * `INTEGER PRIMARY KEY AUTOINCREMENT`, which SQLite guarantees monotonic and never reused, so their
 * key already *is* their cursor.
 */
internal val SYNC_SEQ_TABLES = SYNC_SEQ_TABLES_V43 + SYNC_SEQ_TABLES_V44

/**
 * What a [SyncActionEntity] can name — and, by omission, what it cannot.
 *
 * Every case is configuration or current state a Rider edits directly. Ride History is absent on
 * purpose: Telemetry Samples, markers, minute buckets, exclusion ranges and diagnostic events are
 * pruned on a retention rule, and an action naming one of those would make the server delete exactly
 * the rides the backup exists to preserve. Leaving them unnameable makes that boundary structural
 * rather than a rule someone has to remember (server ADR-0004).
 *
 * [table] is the local table the case removes from, so a test can assert no retained table is ever
 * given a case.
 *
 * @parity /modules/vescape-core/ios/telemetry/SyncActionLog.swift `DeleteTarget`
 * @parity /modules/vescape-core/src/index.ts `DeleteTarget`
 */
enum class DeleteTarget(val wire: String, val table: String) {
  APP_SETTING("appSetting", "app_settings"),
  BOARD("board", "boards"),
  BOARD_SETTING("boardSetting", "board_settings"),
  BOARD_WARNING("boardWarning", "board_warnings"),
  ALERT("alert", "alerts"),
  TUNE_PROFILE("tuneProfile", "tune_profiles"),
  PRIVACY_ZONE("privacyZone", "privacy_zones"),

  /**
   * Favorites have no server table yet (#286 owns that half), so the uploader drops this case until
   * they do. The log still records it: a Favorite removed while the phone is offline has to survive
   * as intent, not as a gap the restore silently re-creates.
   */
  FAVORITE("favorite", "favorites"),
}

/** The only Sync Action type today. Named rather than implied so a later intent needs no second log. */
internal const val SYNC_ACTION_TYPE_DELETE = "delete"

/**
 * One Sync Action: an append-only record that something was semantically removed. A deleted row
 * cannot carry a Change Timestamp saying it is gone, so this log is the only signal the server can
 * apply the same durable state transition from.
 *
 * Its cursor is [id] — `AUTOINCREMENT`, which SQLite guarantees monotonic and never reused — so the
 * log needs no `sync_seq` of its own. The row is transport state, not durable truth: it is pruned
 * once the server has accepted it.
 *
 * Written only from Rider-facing removal paths, never from a trigger or a retention sweep. Intent
 * cannot be inferred from SQL alone, so there is no database trigger behind this table.
 *
 * @parity /modules/vescape-core/ios/telemetry/SyncActionLog.swift `createSyncActionsTable`
 */
@Entity(
  tableName = "sync_actions",
  indices = [Index(value = ["target"])],
)
data class SyncActionEntity(
  @PrimaryKey(autoGenerate = true)
  val id: Long = 0,
  /** Always [SYNC_ACTION_TYPE_DELETE] today; see [DeleteTarget]. */
  val type: String = SYNC_ACTION_TYPE_DELETE,
  /** [DeleteTarget.wire]. */
  val target: String,
  /** Owning Board, or null when the target is not Board-owned. A Board names itself in [key]. */
  @ColumnInfo(name = "board_id")
  val boardId: String?,
  /** The removed row's identity within its scope: a settings key, a warning kind, a row id. */
  val key: String,
  /**
   * Epoch ms of the removal, stamped `max(now, row.updated_at)` from the row being removed. A plain
   * `now` on a rewound clock produces an action the server treats as a no-op, and it cannot
   * self-heal by re-sending because the row it would re-send is gone.
   */
  @ColumnInfo(name = "deleted_at")
  val deletedAt: Long,
)

/** [SyncSequenceEntity] key holding the highest action cursor the server has accepted. */
internal const val SYNC_ACTIONS_UPLOADED_CURSOR = "sync_actions_uploaded"

/**
 * [SyncSequenceEntity] keys holding how far each table has been accepted — the Sync Cursors the
 * uploader commits and cursor-gated retention reads back. Prefixed so a cursor can never collide
 * with the write counters, which are keyed on the bare table name.
 *
 * The five below are the retained tables; every other table's key is derived the same way from
 * `SyncTable`, and a test pins the two spellings together.
 */
internal const val SYNC_CURSOR_PREFIX = "sync_cursor_"
internal const val SYNC_CURSOR_FRAMES = "sync_cursor_telemetry_frames"
internal const val SYNC_CURSOR_MARKERS = "sync_cursor_telemetry_markers"
internal const val SYNC_CURSOR_MINUTE_BUCKETS = "sync_cursor_telemetry_minute_buckets"
internal const val SYNC_CURSOR_DIAGNOSTIC_EVENTS = "sync_cursor_diagnostic_events"
internal const val SYNC_CURSOR_EXCLUSION_RANGES = "sync_cursor_metric_exclusion_ranges"

/**
 * Which Vescape Account this local database belongs to. One row, claimed by the first Account to
 * sign in and never rewritten in place: a different Account replaces the whole database, because
 * resetting the cursors over these rows would upload the previous Account's Boards, Ride History,
 * locations and settings to the new one.
 *
 * Signing out does not clear the binding, so data recorded while signed out keeps its retention
 * protection for the same Account.
 *
 * @parity /modules/vescape-core/ios/sync/SyncStore.swift `createSyncBindingTable`
 */
@Entity(tableName = "sync_binding")
data class SyncBindingEntity(
  @PrimaryKey
  val id: Int = 0,
  @ColumnInfo(name = "account_id")
  val accountId: String,
  @ColumnInfo(name = "bound_at")
  val boundAt: Long,
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
  indices = [
    Index(value = ["sync_seq"]),
  ],
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
  /** Ratcheted last-write-wins timestamp; see [BoardEntity.updatedAt]. */
  @ColumnInfo(name = "updated_at")
  val updatedAt: Long,
  /** Device-local Sync Cursor position; see [SyncSequenceEntity]. */
  @ColumnInfo(name = "sync_seq")
  val syncSeq: Long = 0,
)

@Entity(
  tableName = "app_settings",
  indices = [
    Index(value = ["sync_seq"]),
  ],
)
data class AppSettingEntity(
  @PrimaryKey
  val key: String,
  @ColumnInfo(name = "value_json")
  val valueJson: String,
  /** Ratcheted last-write-wins timestamp; see [BoardEntity.updatedAt]. */
  @ColumnInfo(name = "updated_at")
  val updatedAt: Long,
  /**
   * Device-local Sync Cursor position; see [SyncSequenceEntity]. Stays 0 — below every cursor, so
   * invisible to the upload scan — for the keys in [NOT_SYNCED_SETTING_KEYS].
   */
  @ColumnInfo(name = "sync_seq")
  val syncSeq: Long = 0,
)

/**
 * App settings that name *this phone* rather than the Rider, and so never leave it: restoring them
 * onto a second phone would overwrite that phone's own identity or session state. Enforced at the
 * write path — [TelemetryDao.upsertAppSetting] leaves their `sync_seq` at 0, which is below every
 * Sync Cursor, so no upload scan ever sees the row.
 *
 * Rider Name and Rider Color live in `app_settings` by design, so that Group Ride keeps working
 * signed-out; that placement is what makes them phone-local rather than Account-scoped. See #277.
 *
 * @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `notSyncedSettingKeys`
 */
internal val NOT_SYNCED_SETTING_KEYS = setOf(
  // Rider identity — a second phone in the same Group Ride must not become the same Rider.
  "riderId",
  "riderName",
  "riderColor",
  // Device/session state — names this phone's current session, not the Rider's configuration.
  "selectedBoardId",
  "lastGpsLatitude",
  "lastGpsLongitude",
  "directionPointLatitude",
  "directionPointLongitude",
  // Connection and companion behaviour — phone-side BLE and foreground policy.
  "autoConnect",
  "companionPresenceEnabled",
  "companionPresenceCooldownMinutes",
  "connectionSoundsEnabled",
  "autoCloseEnabled",
  "autoCloseDelayMinutes",
  // Wear pairing — the watch is paired to one phone.
  "wearMirrorIntervalMs",
  "wearAutoLaunchOnConnect",
  // The backup master switch is per phone, and deliberately does not travel through the mechanism
  // it turns off: a restored snapshot must never be able to switch backup back on.
  "syncEnabled",
  // The backup choice is per phone: the expensive first upload belongs to the phone that holds the
  // backlog, so a restore onto a second phone asks that Rider again rather than deciding for them.
  "syncBackupChoiceMade",
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
  /** Backup master switch. Off by default: the uploader does nothing until the Rider turns it on. */
  val syncEnabled: Boolean = false,
  /** Nothing uploads on a metered connection while this is on — mid-ride included. */
  val syncWifiOnly: Boolean = false,
  /** The one-time backup choice has been offered on this phone and answered. */
  val syncBackupChoiceMade: Boolean = false,
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
    Index(value = ["sync_seq"]),
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
  /** Ratcheted last-write-wins timestamp; see [BoardEntity.updatedAt]. */
  @ColumnInfo(name = "updated_at")
  val updatedAt: Long,
  /** Device-local Sync Cursor position; see [SyncSequenceEntity]. */
  @ColumnInfo(name = "sync_seq")
  val syncSeq: Long = 0,
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
    Index(value = ["sync_seq"]),
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
  /**
   * Ratcheted last-write-wins timestamp; see [BoardEntity.updatedAt]. Distinct from
   * [lastDetectedAt], which moves only when the detector fires — a severity or payload change
   * rewrites the row without necessarily being a fresh detection.
   */
  @ColumnInfo(name = "updated_at")
  val updatedAt: Long = 0,
  /** Device-local Sync Cursor position; see [SyncSequenceEntity]. */
  @ColumnInfo(name = "sync_seq")
  val syncSeq: Long = 0,
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
    Index(value = ["sync_seq"]),
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
  /** Device-local Sync Cursor position; see [SyncSequenceEntity]. */
  @ColumnInfo(name = "sync_seq")
  val syncSeq: Long = 0,
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
