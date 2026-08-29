package expo.modules.vescapecore.telemetry

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Update
import androidx.room.Upsert

// @parity /modules/vescape-core/ios/telemetry/TelemetryDao.swift
@Dao
interface TelemetryDao {
  @Insert
  suspend fun insertExclusionRange(exclusion: MetricExclusionRangeEntity): Long

  @Query(
    """
    SELECT * FROM metric_exclusion_ranges
    WHERE start_ms <= :toMs
      AND end_ms >= :fromMs
      AND (:deviceId IS NULL OR device_id = :deviceId)
    ORDER BY start_ms ASC
    """,
  )
  suspend fun getExclusions(fromMs: Long, toMs: Long, deviceId: String?): List<MetricExclusionRangeEntity>

  @Query("DELETE FROM metric_exclusion_ranges WHERE start_ms <= :toMs AND end_ms >= :fromMs")
  suspend fun deleteExclusionsRange(fromMs: Long, toMs: Long): Int

  @Query("DELETE FROM metric_exclusion_ranges")
  suspend fun clearExclusions()

  @Query("DELETE FROM metric_exclusion_ranges WHERE end_ms < :beforeMs")
  suspend fun deleteExclusionsBefore(beforeMs: Long): Int

  @Query(
    """
    SELECT * FROM metric_exclusion_ranges
    WHERE device_id = :deviceId
      AND reason = :reason
      AND end_ms >= :startMs - :mergeGapMs
    ORDER BY end_ms DESC
    LIMIT 1
    """,
  )
  suspend fun getMergeableExclusionRange(
    deviceId: String,
    reason: String,
    startMs: Long,
    mergeGapMs: Long,
  ): MetricExclusionRangeEntity?

  @Update
  suspend fun updateExclusionRange(exclusion: MetricExclusionRangeEntity)

  @Query("SELECT * FROM privacy_zones ORDER BY created_at ASC")
  suspend fun getPrivacyZones(): List<PrivacyZoneEntity>

  @Query("SELECT * FROM privacy_zones WHERE enabled = 1")
  suspend fun getEnabledPrivacyZones(): List<PrivacyZoneEntity>

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun upsertPrivacyZone(zone: PrivacyZoneEntity)

  @Query("UPDATE privacy_zones SET enabled = :enabled, updated_at = :updatedAt WHERE id = :id")
  suspend fun setPrivacyZoneEnabled(id: String, enabled: Boolean, updatedAt: Long)

  @Query("DELETE FROM privacy_zones WHERE id = :id")
  suspend fun deletePrivacyZone(id: String)


  @Insert
  suspend fun insertFrames(frames: List<TelemetryFrameEntity>): List<Long>

  @Update
  suspend fun updateFrame(frame: TelemetryFrameEntity)

  @Insert
  suspend fun insertMarkers(markers: List<TelemetryMarkerEntity>)

  @Insert
  suspend fun insertDiagnosticEvent(event: DiagnosticEventEntity): Long

  @Insert(onConflict = OnConflictStrategy.IGNORE)
  suspend fun insertBucket(bucket: TelemetryMinuteBucketEntity): Long

  @Update
  suspend fun updateBucket(bucket: TelemetryMinuteBucketEntity)

  @Query("SELECT * FROM telemetry_minute_buckets WHERE bucket_start_ms = :bucketStartMs AND device_id = :deviceId LIMIT 1")
  suspend fun getBucket(bucketStartMs: Long, deviceId: String): TelemetryMinuteBucketEntity?

  @Transaction
  suspend fun upsertBuckets(buckets: Collection<TelemetryMinuteBucketEntity>) {
    for (bucket in buckets) {
      val existing = getBucket(bucket.bucketStartMs, bucket.deviceId)
      if (existing == null) {
        insertBucket(bucket)
      } else {
        updateBucket(existing.merge(bucket))
      }
    }
  }

  @Transaction
  suspend fun insertBatch(
    frames: List<TelemetryFrameEntity>,
    buckets: Collection<TelemetryMinuteBucketEntity>,
    markers: List<TelemetryMarkerEntity>,
    exclusions: List<MetricExclusionRangeEntity> = emptyList(),
  ) {
    if (frames.isNotEmpty()) insertFrames(frames)
    if (buckets.isNotEmpty()) upsertBuckets(buckets)
    if (markers.isNotEmpty()) insertMarkers(markers)
    if (exclusions.isNotEmpty()) upsertExclusionRanges(exclusions)
  }

  @Transaction
  suspend fun upsertExclusionRanges(exclusions: List<MetricExclusionRangeEntity>) {
    for (exclusion in exclusions.sortedWith(compareBy({ it.deviceId }, { it.reason }, { it.startMs }))) {
      val existing = getMergeableExclusionRange(
        exclusion.deviceId,
        exclusion.reason,
        exclusion.startMs,
        METRIC_EXCLUSION_RANGE_MERGE_GAP_MS,
      )
      if (existing == null) {
        insertExclusionRange(exclusion)
      } else {
        updateExclusionRange(
          existing.copy(
            endMs = maxOf(existing.endMs, exclusion.endMs),
            sampleCount = existing.sampleCount + exclusion.sampleCount,
          ),
        )
      }
    }
  }

  @Query(
    """
    SELECT * FROM telemetry_minute_buckets
    WHERE (:deviceId IS NULL OR device_id = :deviceId)
      AND bucket_start_ms <= :beforeMs
      AND bucket_start_ms >= :fromMs
      AND bucket_start_ms <= :toMs
      AND sample_count > 0
    ORDER BY bucket_start_ms DESC
    LIMIT :limit
    """,
  )
  suspend fun getHistoryBuckets(
    fromMs: Long,
    toMs: Long,
    beforeMs: Long,
    deviceId: String?,
    limit: Int,
  ): List<TelemetryMinuteBucketEntity>

  @Query("SELECT * FROM telemetry_minute_buckets ORDER BY bucket_start_ms ASC")
  suspend fun getAllHistoryBucketsAsc(): List<TelemetryMinuteBucketEntity>

  @Query(
    """
    SELECT * FROM telemetry_markers
    WHERE occurred_at_ms >= :fromMs
      AND occurred_at_ms <= :toMs
      AND (:deviceId IS NULL OR device_id = :deviceId)
    ORDER BY occurred_at_ms ASC
    """,
  )
  suspend fun getMarkers(fromMs: Long, toMs: Long, deviceId: String?): List<TelemetryMarkerEntity>

  @Query(
    """
    SELECT * FROM diagnostic_events
    WHERE occurred_at_ms >= :fromMs
      AND occurred_at_ms <= :toMs
      AND (:deviceId IS NULL OR device_id = :deviceId)
    ORDER BY occurred_at_ms DESC
    LIMIT :limit
    """,
  )
  suspend fun getDiagnosticEvents(
    fromMs: Long,
    toMs: Long,
    deviceId: String?,
    limit: Int,
  ): List<DiagnosticEventEntity>

  @Query(
    """
    SELECT * FROM telemetry_frames
    WHERE captured_at_ms <= :fromMs
      AND (:deviceId IS NULL OR device_id = :deviceId)
      AND (flags & :keyframeFlag) != 0
    ORDER BY captured_at_ms DESC
    LIMIT 1
    """,
  )
  suspend fun getLatestKeyframeBefore(
    fromMs: Long,
    deviceId: String?,
    keyframeFlag: Int = TELEMETRY_FLAG_KEYFRAME,
  ): TelemetryFrameEntity?

  @Query(
    """
    SELECT * FROM telemetry_frames
    WHERE captured_at_ms >= :fromMs
      AND captured_at_ms <= :toMs
      AND (:deviceId IS NULL OR device_id = :deviceId)
    ORDER BY captured_at_ms ASC
    LIMIT :limit
    """,
  )
  suspend fun getFrames(fromMs: Long, toMs: Long, deviceId: String?, limit: Int): List<TelemetryFrameEntity>

  @Query(
    """
    SELECT DISTINCT device_id FROM telemetry_frames
    WHERE captured_at_ms >= :fromMs
      AND captured_at_ms <= :toMs
      AND device_id IS NOT NULL
    ORDER BY device_id ASC
    """,
  )
  suspend fun getDeviceIdsInRange(fromMs: Long, toMs: Long): List<String>

  @Query(
    """
    SELECT * FROM telemetry_frames
    WHERE captured_at_ms >= :fromMs
      AND captured_at_ms <= :toMs
      AND device_id = :deviceId
    ORDER BY captured_at_ms ASC
    LIMIT 1
    """,
  )
  suspend fun getFirstFrameInRange(
    fromMs: Long,
    toMs: Long,
    deviceId: String,
  ): TelemetryFrameEntity?

  @Query("SELECT COUNT(*) FROM telemetry_frames")
  suspend fun countFrames(): Long

  @Query("SELECT COALESCE(SUM(gps_point_count), 0) FROM telemetry_minute_buckets WHERE sample_count > 0")
  suspend fun countTelemetryGpsPoints(): Long

  @Query("SELECT MIN(captured_at_ms) FROM telemetry_frames")
  suspend fun firstFrameAt(): Long?

  @Query("SELECT MAX(captured_at_ms) FROM telemetry_frames")
  suspend fun lastFrameAt(): Long?

  @Query("DELETE FROM telemetry_frames WHERE captured_at_ms < :beforeMs")
  suspend fun deleteFramesBefore(beforeMs: Long): Int

  @Query("DELETE FROM telemetry_markers WHERE occurred_at_ms < :beforeMs")
  suspend fun deleteMarkersBefore(beforeMs: Long): Int

  @Query("DELETE FROM telemetry_minute_buckets WHERE bucket_start_ms < :beforeMs")
  suspend fun deleteBucketsBefore(beforeMs: Long): Int

  @Query("DELETE FROM diagnostic_events WHERE occurred_at_ms < :beforeMs")
  suspend fun deleteDiagnosticEventsBefore(beforeMs: Long): Int

  @Transaction
  suspend fun deleteBefore(beforeMs: Long): Int {
    val frames = deleteFramesBefore(beforeMs)
    deleteMarkersBefore(beforeMs)
    deleteBucketsBefore(beforeMs)
    deleteDiagnosticEventsBefore(beforeMs)
    deleteExclusionsBefore(beforeMs)
    return frames
  }

  @Query(
    """
    DELETE FROM telemetry_frames
    WHERE captured_at_ms >= :fromMs
      AND captured_at_ms <= :toMs
      AND (
        (:deviceId IS NOT NULL AND device_id = :deviceId)
        OR (:deviceId IS NULL AND device_id IS NULL)
      )
    """,
  )
  suspend fun deleteFramesRange(fromMs: Long, toMs: Long, deviceId: String?): Int

  @Query(
    """
    DELETE FROM telemetry_markers
    WHERE occurred_at_ms >= :fromMs
      AND occurred_at_ms <= :toMs
      AND (
        (:deviceId IS NOT NULL AND device_id = :deviceId)
        OR (:deviceId IS NULL AND device_id IS NULL)
      )
    """,
  )
  suspend fun deleteMarkersRange(fromMs: Long, toMs: Long, deviceId: String?): Int

  @Query(
    """
    DELETE FROM telemetry_minute_buckets
    WHERE last_sample_at_ms >= :fromMs
      AND first_sample_at_ms <= :toMs
      AND device_id = :bucketDeviceId
    """,
  )
  suspend fun deleteBucketsRange(fromMs: Long, toMs: Long, bucketDeviceId: String): Int

  @Transaction
  suspend fun deleteRange(fromMs: Long, toMs: Long, deviceId: String?): Int {
    val frames = deleteFramesRange(fromMs, toMs, deviceId)
    deleteMarkersRange(fromMs, toMs, deviceId)
    deleteBucketsRange(fromMs, toMs, deviceId ?: UNKNOWN_TELEMETRY_DEVICE_ID)
    deleteExclusionsRange(fromMs, toMs)
    return frames
  }

  @Query("DELETE FROM telemetry_frames WHERE captured_at_ms >= :fromMs AND captured_at_ms <= :toMs")
  suspend fun deleteFramesRangeAllDevices(fromMs: Long, toMs: Long): Int

  @Query("DELETE FROM telemetry_markers WHERE occurred_at_ms >= :fromMs AND occurred_at_ms <= :toMs")
  suspend fun deleteMarkersRangeAllDevices(fromMs: Long, toMs: Long): Int

  @Query(
    """
    DELETE FROM telemetry_minute_buckets
    WHERE last_sample_at_ms >= :fromMs
      AND first_sample_at_ms <= :toMs
    """,
  )
  suspend fun deleteBucketsRangeAllDevices(fromMs: Long, toMs: Long): Int

  @Transaction
  suspend fun deleteRangeAllDevices(fromMs: Long, toMs: Long): Int {
    val frames = deleteFramesRangeAllDevices(fromMs, toMs)
    deleteMarkersRangeAllDevices(fromMs, toMs)
    deleteBucketsRangeAllDevices(fromMs, toMs)
    deleteExclusionsRange(fromMs, toMs)
    return frames
  }

  @Query("DELETE FROM telemetry_frames")
  suspend fun clearFrames()

  @Query("DELETE FROM telemetry_markers")
  suspend fun clearMarkers()

  @Query("DELETE FROM telemetry_minute_buckets")
  suspend fun clearBuckets()

  @Query("DELETE FROM diagnostic_events")
  suspend fun clearDiagnosticEvents()

  @Transaction
  suspend fun clearAll() {
    clearFrames()
    clearMarkers()
    clearBuckets()
    clearDiagnosticEvents()
    clearExclusions()
  }

  @Query("SELECT * FROM boards ORDER BY created_at ASC")
  suspend fun getBoards(): List<BoardEntity>

  @Query("SELECT * FROM boards WHERE id = :id LIMIT 1")
  suspend fun getBoard(id: String): BoardEntity?

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun upsertBoard(board: BoardEntity)

  @Query("SELECT * FROM board_settings WHERE board_id = :boardId")
  suspend fun getBoardSettings(boardId: String): List<BoardSettingEntity>

  @Query("SELECT * FROM board_settings WHERE board_id IN (:boardIds)")
  suspend fun getBoardSettings(boardIds: List<String>): List<BoardSettingEntity>

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun upsertBoardSetting(setting: BoardSettingEntity)

  @Query("DELETE FROM board_settings WHERE board_id = :boardId AND key = :key")
  suspend fun deleteBoardSetting(boardId: String, key: String)

  @Transaction
  suspend fun upsertBoardWithSettings(board: BoardEntity, settings: List<BoardSettingEntity>, deletedKeys: List<String>) {
    upsertBoard(board)
    deletedKeys.forEach { deleteBoardSetting(board.id, it) }
    settings.forEach { upsertBoardSetting(it) }
  }

  @Query("DELETE FROM board_settings WHERE board_id = :boardId")
  suspend fun deleteBoardSettings(boardId: String)

  @Query("DELETE FROM boards WHERE id = :id")
  suspend fun deleteBoard(id: String)

  @Transaction
  suspend fun deleteBoardWithSettings(id: String) {
    deleteBoardSettings(id)
    deleteBoardWarnings(id)
    // Alert Rules are Board-owned (#254) — drop them with the Board so no orphan rows survive.
    deleteAlertRules(id)
    deleteBoard(id)
  }

  @Query("SELECT * FROM alerts WHERE board_id = :boardId ORDER BY created_at ASC")
  suspend fun getAlertRules(boardId: String): List<AlertRuleEntity>

  @Query("SELECT * FROM alerts WHERE board_id = :boardId AND enabled = 1 ORDER BY created_at ASC")
  suspend fun getEnabledAlertRules(boardId: String): List<AlertRuleEntity>

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun upsertAlertRule(rule: AlertRuleEntity)

  @Query("UPDATE alerts SET enabled = :enabled WHERE board_id = :boardId AND id = :id")
  suspend fun setAlertRuleEnabled(boardId: String, id: String, enabled: Boolean)

  @Query("DELETE FROM alerts WHERE board_id = :boardId AND id = :id")
  suspend fun deleteAlertRule(boardId: String, id: String)

  @Query("DELETE FROM alerts WHERE board_id = :boardId")
  suspend fun deleteAlertRules(boardId: String)

  @Query("SELECT * FROM app_settings")
  suspend fun getAllAppSettings(): List<AppSettingEntity>

  @Query("SELECT * FROM app_settings WHERE key = :key LIMIT 1")
  suspend fun getAppSetting(key: String): AppSettingEntity?

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun upsertAppSetting(setting: AppSettingEntity)

  @Query("DELETE FROM app_settings WHERE key = :key")
  suspend fun deleteAppSetting(key: String)

  // Tune Profile / Tune History DAO. Transactional bodies below are mirrored in Swift.
  // @parity /modules/vescape-core/ios/telemetry/TuneProfileStore.swift
  @Query("SELECT * FROM tune_profiles WHERE board_id = :boardId AND refloat_base_version = :refloatBaseVersion ORDER BY created_at ASC")
  suspend fun getTuneProfilesByBoard(boardId: String, refloatBaseVersion: String): List<TuneProfileEntity>

  @Query("SELECT * FROM tune_profiles WHERE id = :id LIMIT 1")
  suspend fun getTuneProfile(id: String): TuneProfileEntity?

  @Query("DELETE FROM tune_profiles WHERE id = :id")
  suspend fun deleteTuneProfile(id: String)

  @Query("DELETE FROM tune_history_entries WHERE profile_id = :profileId")
  suspend fun deleteTuneHistoryForProfile(profileId: String)

  @Query("UPDATE tune_profiles SET name = :name, icon = :icon, color = :color, updated_at = :updatedAt WHERE id = :profileId")
  suspend fun updateProfileMetadata(
    profileId: String,
    name: String,
    icon: String,
    color: String,
    updatedAt: Long,
  ): Int

  @Query("SELECT * FROM tune_history_entries WHERE id = :id LIMIT 1")
  suspend fun getTuneHistoryEntry(id: Long): TuneHistoryEntryEntity?

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun upsertTuneProfile(profile: TuneProfileEntity)

  @Insert(onConflict = OnConflictStrategy.IGNORE)
  suspend fun insertTuneProfile(profile: TuneProfileEntity): Long

  @Query("SELECT COUNT(*) FROM tune_profiles WHERE board_id = :boardId AND refloat_base_version = :refloatBaseVersion")
  suspend fun countTuneProfilesForBoard(boardId: String, refloatBaseVersion: String): Int

  @Insert
  suspend fun insertTuneHistoryEntry(entry: TuneHistoryEntryEntity): Long

  // `id` breaks ties: a save and a rollback can land in the same millisecond, and without a
  // monotonic tiebreaker `created_at DESC` alone returns them in insertion order — oldest first —
  // which is the opposite of what Tune History shows.
  @Query("SELECT * FROM tune_history_entries WHERE profile_id = :profileId ORDER BY created_at DESC, id DESC")
  suspend fun getTuneHistoryEntries(profileId: String): List<TuneHistoryEntryEntity>

  @Query("UPDATE tune_profiles SET fields_json = :fieldsJson, updated_at = :updatedAt WHERE id = :profileId")
  suspend fun updateProfileFields(profileId: String, fieldsJson: String, updatedAt: Long): Int

  @Transaction
  suspend fun saveTuneProfile(profileId: String, fieldsJson: String, updatedAt: Long): TuneProfileEntity {
    val current = getTuneProfile(profileId) ?: throw IllegalArgumentException("Tune Profile not found: $profileId")
    insertTuneHistoryEntry(
      TuneHistoryEntryEntity(
        profileId = current.id,
        fieldsJson = current.fieldsJson,
        createdAt = updatedAt,
      ),
    )
    updateProfileFields(profileId, fieldsJson, updatedAt)
    return getTuneProfile(profileId) ?: throw IllegalStateException("Tune Profile disappeared during save: $profileId")
  }

  @Transaction
  suspend fun deleteTuneProfileSafe(profileId: String) {
    val profile = getTuneProfile(profileId) ?: throw IllegalArgumentException("Tune Profile not found: $profileId")
    if (countTuneProfilesForBoard(profile.boardId, profile.refloatBaseVersion) <= 1) {
      throw IllegalStateException("Cannot delete the last profile for a board")
    }
    deleteTuneHistoryForProfile(profileId)
    deleteTuneProfile(profileId)
  }

  @Transaction
  suspend fun rollbackTuneProfile(profileId: String, historyEntryId: Long): TuneProfileEntity {
    val profile = getTuneProfile(profileId) ?: throw IllegalArgumentException("Tune Profile not found: $profileId")
    val entry = getTuneHistoryEntry(historyEntryId) ?: throw IllegalArgumentException("History entry not found: $historyEntryId")
    if (entry.profileId != profileId) throw IllegalArgumentException("History entry does not belong to this profile")
    val now = System.currentTimeMillis()
    insertTuneHistoryEntry(
      TuneHistoryEntryEntity(
        profileId = profile.id,
        fieldsJson = profile.fieldsJson,
        createdAt = now,
      ),
    )
    updateProfileFields(profileId, entry.fieldsJson, now)
    return getTuneProfile(profileId) ?: throw IllegalStateException("Tune Profile disappeared during rollback: $profileId")
  }

  @Transaction
  suspend fun insertTuneProfileIfBoardHasNone(
    profile: TuneProfileEntity,
    historyEntry: TuneHistoryEntryEntity,
  ): TuneProfileEntity? {
    if (countTuneProfilesForBoard(profile.boardId, profile.refloatBaseVersion) > 0) return null
    val inserted = insertTuneProfile(profile)
    if (inserted == -1L) return null
    insertTuneHistoryEntry(historyEntry)
    return profile
  }

  // Board Warnings — see BoardWarningRegistry for lifecycle rules.
  // @parity /modules/vescape-core/ios/warnings/BoardWarningStore.swift

  @Query("SELECT * FROM board_warnings WHERE board_id = :boardId AND kind = :kind LIMIT 1")
  suspend fun getBoardWarning(boardId: String, kind: String): BoardWarningEntity?

  @Query("SELECT * FROM board_warnings WHERE board_id = :boardId ORDER BY first_detected_at ASC")
  suspend fun getBoardWarnings(boardId: String): List<BoardWarningEntity>

  @Query("SELECT * FROM board_warnings ORDER BY board_id ASC, first_detected_at ASC")
  suspend fun getAllBoardWarnings(): List<BoardWarningEntity>

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun upsertBoardWarning(warning: BoardWarningEntity)

  @Query("DELETE FROM board_warnings WHERE board_id = :boardId AND kind = :kind")
  suspend fun deleteBoardWarning(boardId: String, kind: String): Int

  @Query("DELETE FROM board_warnings WHERE board_id = :boardId")
  suspend fun deleteBoardWarnings(boardId: String): Int

  // VESC Fault Occurrences — see VescFaultCoordinator for lifecycle rules. Deliberately absent from
  // `deleteBoardWithSettings`: fault evidence outlives the Board record.
  // @parity /modules/vescape-core/ios/faults/VescFaultStore.swift

  @Query("SELECT * FROM vesc_fault_occurrences WHERE board_id = :boardId ORDER BY discovered_at DESC, rowid DESC")
  suspend fun getVescFaults(boardId: String): List<VescFaultOccurrenceEntity>

  @Query("SELECT * FROM vesc_fault_occurrences ORDER BY board_id ASC, discovered_at DESC, rowid DESC")
  suspend fun getAllVescFaults(): List<VescFaultOccurrenceEntity>

  @Query("SELECT * FROM vesc_fault_occurrences WHERE id = :id LIMIT 1")
  suspend fun getVescFault(id: String): VescFaultOccurrenceEntity?

  /** Newest still-open live occurrence for a Board — rehydrates coordinator state after restart. */
  @Query(
    "SELECT * FROM vesc_fault_occurrences WHERE board_id = :boardId AND source = 'live' " +
      "AND cleared_at IS NULL ORDER BY discovered_at DESC, rowid DESC LIMIT 1",
  )
  suspend fun getOpenVescFault(boardId: String): VescFaultOccurrenceEntity?

  @Insert(onConflict = OnConflictStrategy.IGNORE)
  suspend fun insertVescFault(fault: VescFaultOccurrenceEntity): Long

  @Query(
    "UPDATE vesc_fault_occurrences SET last_observed_at = :lastObservedAt, cleared_at = :clearedAt, " +
      "register_position = :registerPosition WHERE id = :id",
  )
  suspend fun updateVescFaultLifecycle(
    id: String,
    lastObservedAt: Long,
    clearedAt: Long?,
    registerPosition: Int?,
  )

  /**
   * Insert-or-advance. Deliberately not a `REPLACE` upsert: that rewrites `dismissed` from the
   * caller's in-memory snapshot, so a stale heartbeat could un-dismiss what the rider just
   * acknowledged. Dismissal has its own statement.
   */
  @Transaction
  suspend fun upsertVescFault(fault: VescFaultOccurrenceEntity) {
    if (insertVescFault(fault) == -1L) {
      updateVescFaultLifecycle(fault.id, fault.lastObservedAtMs, fault.clearedAtMs, fault.registerPosition)
    }
  }

  @Query("UPDATE vesc_fault_occurrences SET dismissed = :dismissed WHERE id = :id")
  suspend fun setVescFaultDismissed(id: String, dismissed: Boolean): Int

  @Query("SELECT * FROM board_config_values WHERE board_id = :boardId AND refloat_base_version = :refloatBaseVersion LIMIT 1")
  suspend fun getBoardConfigValues(boardId: String, refloatBaseVersion: String): BoardConfigValuesEntity?

  @Query("SELECT * FROM board_config_values WHERE board_id = :boardId ORDER BY captured_at DESC LIMIT 1")
  suspend fun getLatestBoardConfigValues(boardId: String): BoardConfigValuesEntity?

  @Upsert
  suspend fun upsertBoardConfigValues(values: BoardConfigValuesEntity)

  @Query("DELETE FROM board_config_values WHERE board_id = :boardId")
  suspend fun deleteBoardConfigValues(boardId: String)

  @Query("SELECT * FROM motor_config_values WHERE board_id = :boardId ORDER BY captured_at DESC LIMIT 1")
  suspend fun getLatestMotorConfigValues(boardId: String): MotorConfigValuesEntity?

  @Upsert
  suspend fun upsertMotorConfigValues(values: MotorConfigValuesEntity)

  @Query("DELETE FROM motor_config_values WHERE board_id = :boardId")
  suspend fun deleteMotorConfigValues(boardId: String)

  /**
   * Same baseline-then-notice transaction as [replaceBaselineAndNotice], for motor config. Both
   * configs write into one notice row per Board: a rider does not care which subsystem a setting
   * lives in, only that their board changed while Vescape was away.
   */
  @Transaction
  suspend fun replaceMotorBaselineAndNotice(
    values: MotorConfigValuesEntity,
    buildNotice: (MotorConfigValuesEntity?, BoardConfigChangeNoticeEntity?) -> BoardConfigChangeNoticeEntity?,
  ): BoardConfigChangeNoticeEntity? {
    val notice = buildNotice(getLatestMotorConfigValues(values.boardId), getBoardConfigChangeNotice(values.boardId))
    if (notice != null) upsertBoardConfigChangeNotice(notice)
    upsertMotorConfigValues(values)
    return notice
  }

  @Query("SELECT * FROM board_config_change_notices WHERE board_id = :boardId LIMIT 1")
  suspend fun getBoardConfigChangeNotice(boardId: String): BoardConfigChangeNoticeEntity?

  @Upsert
  suspend fun upsertBoardConfigChangeNotice(notice: BoardConfigChangeNoticeEntity)

  @Query("DELETE FROM board_config_change_notices WHERE board_id = :boardId")
  suspend fun deleteBoardConfigChangeNotice(boardId: String)

  @Transaction
  suspend fun replaceBaselineAndNotice(values: BoardConfigValuesEntity, buildNotice: (BoardConfigValuesEntity?) -> BoardConfigChangeNoticeEntity?): BoardConfigChangeNoticeEntity? {
    val notice = buildNotice(getBoardConfigValues(values.boardId, values.refloatBaseVersion))
    if (notice != null) upsertBoardConfigChangeNotice(notice)
    upsertBoardConfigValues(values)
    return notice
  }

  // Favorites — durable pins over Ride History (ADR 0029). Deleting a row only unpins; telemetry
  // inside the range is never touched here.
  // @parity /modules/vescape-core/ios/telemetry/FavoriteStore.swift

  @Query("SELECT * FROM favorites ORDER BY start_ms DESC")
  suspend fun getFavorites(): List<FavoriteEntity>

  @Insert
  suspend fun insertFavorite(favorite: FavoriteEntity)

  @Query("SELECT * FROM favorites WHERE id = :id")
  suspend fun getFavorite(id: String): FavoriteEntity?

  /** Re-trim/rename one row in place so its identity and Favorite Media remain stable. */
  @Update
  suspend fun updateFavorite(favorite: FavoriteEntity): Int

  @Query("DELETE FROM favorites WHERE id = :id")
  suspend fun deleteFavoriteRow(id: String): Int

  // Favorite Media — native manifest metadata truth (ADR 0030).
  // @parity /modules/vescape-core/ios/telemetry/FavoriteMediaStore.swift

  @Query("SELECT * FROM favorite_media WHERE favorite_id = :favoriteId ORDER BY created_at, id")
  suspend fun getFavoriteMedia(favoriteId: String): List<FavoriteMediaEntity>

  @Insert
  suspend fun insertFavoriteMedia(media: FavoriteMediaEntity)

  @Query("DELETE FROM favorite_media WHERE id = :id")
  suspend fun deleteFavoriteMedia(id: String): Int

  @Query("DELETE FROM favorite_media WHERE favorite_id = :favoriteId")
  suspend fun deleteFavoriteMediaForFavorite(favoriteId: String): Int

  @Query("DELETE FROM favorite_media WHERE favorite_id NOT IN (SELECT id FROM favorites)")
  suspend fun deleteOrphanFavoriteMedia(): Int

  /** Parent-covered raw cascade: media rows and Favorite disappear in one SQLite transaction. */
  @Transaction
  suspend fun deleteFavorite(id: String): Int {
    deleteFavoriteMediaForFavorite(id)
    return deleteFavoriteRow(id)
  }
}

private fun TelemetryMinuteBucketEntity.merge(next: TelemetryMinuteBucketEntity): TelemetryMinuteBucketEntity {
  return copy(
    deviceName = next.deviceName ?: deviceName,
    sampleCount = sampleCount + next.sampleCount,
    firstSampleAtMs = minOf(firstSampleAtMs, next.firstSampleAtMs),
    lastSampleAtMs = maxOf(lastSampleAtMs, next.lastSampleAtMs),
    sumAbsSpeedCentiKmh = sumAbsSpeedCentiKmh + next.sumAbsSpeedCentiKmh,
    movingSpeedSampleCount = mergeNullableSums(movingSpeedSampleCount, next.movingSpeedSampleCount),
    sumMovingAbsSpeedCentiKmh = mergeNullableSums(sumMovingAbsSpeedCentiKmh, next.sumMovingAbsSpeedCentiKmh),
    maxAbsSpeedCentiKmh = maxOf(maxAbsSpeedCentiKmh, next.maxAbsSpeedCentiKmh),
    minBatteryVoltageMv = when {
      minBatteryVoltageMv == null -> next.minBatteryVoltageMv
      next.minBatteryVoltageMv == null -> minBatteryVoltageMv
      else -> minOf(minBatteryVoltageMv, next.minBatteryVoltageMv)
    },
    maxMotorCurrentAbsMa = maxOf(maxMotorCurrentAbsMa, next.maxMotorCurrentAbsMa),
    maxBatteryCurrentAbsMa = maxOf(maxBatteryCurrentAbsMa, next.maxBatteryCurrentAbsMa),
    batteryUsedWhMilli = batteryUsedWhMilli + next.batteryUsedWhMilli,
    batteryRegenWhMilli = batteryRegenWhMilli + next.batteryRegenWhMilli,
    maxDutyAbsPermille = maxOf(maxDutyAbsPermille, next.maxDutyAbsPermille),
    firstOdometerCm = when {
      firstOdometerCm == null -> next.firstOdometerCm
      next.firstOdometerCm == null -> firstOdometerCm
      next.firstSampleAtMs < firstSampleAtMs -> next.firstOdometerCm
      else -> firstOdometerCm
    },
    lastOdometerCm = when {
      lastOdometerCm == null -> next.lastOdometerCm
      next.lastOdometerCm == null -> lastOdometerCm
      next.lastSampleAtMs >= lastSampleAtMs -> next.lastOdometerCm
      else -> lastOdometerCm
    },
    gpsPointCount = gpsPointCount + next.gpsPointCount,
    preciseGpsPointCount = preciseGpsPointCount + next.preciseGpsPointCount,
    gpsDistanceCm = gpsDistanceCm + next.gpsDistanceCm,
    maxGpsSpeedCentiMps = when {
      maxGpsSpeedCentiMps == null -> next.maxGpsSpeedCentiMps
      next.maxGpsSpeedCentiMps == null -> maxGpsSpeedCentiMps
      else -> maxOf(maxGpsSpeedCentiMps, next.maxGpsSpeedCentiMps)
    },
    maxTempMosfetDeciC = when {
      maxTempMosfetDeciC == null -> next.maxTempMosfetDeciC
      next.maxTempMosfetDeciC == null -> maxTempMosfetDeciC
      else -> maxOf(maxTempMosfetDeciC, next.maxTempMosfetDeciC)
    },
    maxTempMotorDeciC = when {
      maxTempMotorDeciC == null -> next.maxTempMotorDeciC
      next.maxTempMotorDeciC == null -> maxTempMotorDeciC
      else -> maxOf(maxTempMotorDeciC, next.maxTempMotorDeciC)
    },
    firstLatitudeE7 = when {
      firstLatitudeE7 != null && next.firstSampleAtMs >= firstSampleAtMs -> firstLatitudeE7
      next.firstLatitudeE7 != null -> next.firstLatitudeE7
      else -> firstLatitudeE7
    },
    firstLongitudeE7 = when {
      firstLongitudeE7 != null && next.firstSampleAtMs >= firstSampleAtMs -> firstLongitudeE7
      next.firstLongitudeE7 != null -> next.firstLongitudeE7
      else -> firstLongitudeE7
    },
    firstMovingAtMs = mergeNullableMin(firstMovingAtMs, next.firstMovingAtMs),
    lastMovingAtMs = mergeNullableMax(lastMovingAtMs, next.lastMovingAtMs),
  )
}

private fun mergeNullableSums(a: Int?, b: Int?): Int? {
  if (a == null && b == null) return null
  return (a ?: 0) + (b ?: 0)
}

private fun mergeNullableSums(a: Long?, b: Long?): Long? {
  if (a == null && b == null) return null
  return (a ?: 0L) + (b ?: 0L)
}

private fun mergeNullableMin(a: Long?, b: Long?): Long? {
  if (a == null) return b
  if (b == null) return a
  return minOf(a, b)
}

private fun mergeNullableMax(a: Long?, b: Long?): Long? {
  if (a == null) return b
  if (b == null) return a
  return maxOf(a, b)
}
