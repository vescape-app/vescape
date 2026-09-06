package expo.modules.vescapecore.telemetry

import androidx.room.Database
import androidx.room.RoomDatabase

// @parity /modules/vescape-core/ios/telemetry/DatabaseBackupManager.swift `TELEMETRY_SCHEMA_VERSION`
internal const val TELEMETRY_DATABASE_VERSION = 42

/** Production Room schema/DAO, portable to JVM hosts. Android open/migration lifecycle stays in [TelemetryDatabase]. */
@Database(
  entities = [
    TelemetryFrameEntity::class, TelemetryMinuteBucketEntity::class, TelemetryMarkerEntity::class,
    MetricExclusionRangeEntity::class, BoardEntity::class, BoardSettingEntity::class, AlertRuleEntity::class,
    AppSettingEntity::class, TuneProfileEntity::class, TuneHistoryEntryEntity::class, DiagnosticEventEntity::class,
    PrivacyZoneEntity::class, BoardWarningEntity::class, VescFaultOccurrenceEntity::class,
    VescFaultCaptureEntity::class, VescFaultCaptureSampleEntity::class, FavoriteEntity::class,
    FavoriteMediaEntity::class, BoardConfigValuesEntity::class, MotorConfigValuesEntity::class,
    BoardConfigChangeNoticeEntity::class,
  ],
  version = TELEMETRY_DATABASE_VERSION,
  exportSchema = false,
)
abstract class TelemetryRoomDatabase : RoomDatabase() {
  abstract fun telemetryDao(): TelemetryDao
}
