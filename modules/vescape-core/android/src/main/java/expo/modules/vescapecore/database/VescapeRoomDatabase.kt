package expo.modules.vescapecore.database

import androidx.room.Database
import androidx.room.RoomDatabase

// @parity /modules/vescape-core/ios/database/DatabaseBackupManager.swift `VESCAPE_DATABASE_VERSION`
internal const val VESCAPE_DATABASE_VERSION = 57

@Database(
  entities = [
    RideTrackPointEntity::class,
    TelemetryFrameEntity::class, TelemetryMinuteBucketEntity::class, TelemetryMarkerEntity::class,
    TelemetryChunkEntity::class,
    MetricExclusionRangeEntity::class, BoardEntity::class, BoardSettingEntity::class, AlertRuleEntity::class,
    AppSettingEntity::class, TuneProfileEntity::class, TuneHistoryEntryEntity::class, DiagnosticEventEntity::class,
    PrivacyZoneEntity::class, BoardWarningEntity::class, VescFaultOccurrenceEntity::class,
    VescFaultCaptureEntity::class, VescFaultCaptureSampleEntity::class, FavoriteEntity::class,
    FavoriteMediaEntity::class, BoardConfigValuesEntity::class, BoardConfigSchemaEntity::class,
    MotorConfigValuesEntity::class,
    BoardConfigChangeNoticeEntity::class, SavedAccessoryEntity::class,
    AccessoryGroundClearanceEntity::class,
    AccessoryBrakeLightEntity::class,
    AccessoryCapabilitySettingsEntity::class,
    WeatherObservationEntity::class,
  ],
  version = VESCAPE_DATABASE_VERSION,
  exportSchema = true,
)
abstract class VescapeRoomDatabase : RoomDatabase() {
  abstract fun vescapeDao(): VescapeDao
}
