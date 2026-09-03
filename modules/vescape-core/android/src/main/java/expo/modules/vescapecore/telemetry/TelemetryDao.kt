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
      AND (:boardId IS NULL OR board_id = :boardId)
    ORDER BY start_ms ASC
    """,
  )
  suspend fun getExclusions(fromMs: Long, toMs: Long, boardId: String?): List<MetricExclusionRangeEntity>

  @Query("DELETE FROM metric_exclusion_ranges WHERE start_ms <= :toMs AND end_ms >= :fromMs")
  suspend fun deleteExclusionsRange(fromMs: Long, toMs: Long): Int

  @Query("DELETE FROM metric_exclusion_ranges")
  suspend fun clearExclusions()

  @Query("DELETE FROM metric_exclusion_ranges WHERE end_ms < :beforeMs")
  suspend fun deleteExclusionsBefore(beforeMs: Long): Int

  @Query(
    """
    SELECT * FROM metric_exclusion_ranges
    WHERE board_id = :boardId
      AND reason = :reason
      AND end_ms >= :startMs - :mergeGapMs
    ORDER BY end_ms DESC
    LIMIT 1
    """,
  )
  suspend fun getMergeableExclusionRange(
    boardId: String,
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

  @Query(
    """
    SELECT * FROM telemetry_minute_buckets
    WHERE bucket_start_ms = :bucketStartMs
      AND board_id = :boardId
      AND recording_id = :recordingId
    LIMIT 1
    """,
  )
  suspend fun getBucket(
    bucketStartMs: Long,
    boardId: String,
    recordingId: String,
  ): TelemetryMinuteBucketEntity?

  @Transaction
  suspend fun upsertBuckets(buckets: Collection<TelemetryMinuteBucketEntity>) {
    for (bucket in buckets) {
      val existing = getBucket(bucket.bucketStartMs, bucket.boardId, bucket.recordingId)
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
    trackPoints: List<RideTrackPointEntity> = emptyList(),
  ) {
    if (frames.isNotEmpty()) insertFrames(frames)
    if (buckets.isNotEmpty()) upsertBuckets(buckets)
    if (markers.isNotEmpty()) insertMarkers(markers)
    if (exclusions.isNotEmpty()) upsertExclusionRanges(exclusions)
    if (trackPoints.isNotEmpty()) insertRideTrackPoints(trackPoints)
  }

  // Ride Recording identity and Ride Track (ADR 0038). The durable contract #449 reads for history
  // composition and #450 extends across Board Session teardown.

  @Insert
  suspend fun insertRideRecording(recording: RideRecordingEntity)

  @Query(
    """
    UPDATE ride_recordings
    SET ended_at_ms = :endedAtMs, ended_reason = :reason
    WHERE id = :id AND ended_at_ms IS NULL
    """,
  )
  suspend fun endRideRecording(id: String, endedAtMs: Long, reason: String): Int

  /**
   * Close every recording left open by a process that died without ending it. Called before minting
   * a new recording, which is the one moment we know the old row can no longer be rejoined.
   *
   * @parity /modules/vescape-core/ios/telemetry/RideTrackStore.swift `closeAbandonedRideRecordings`
   */
  @Query(
    """
    UPDATE ride_recordings SET ended_at_ms = :endedAtMs, ended_reason = :reason
    WHERE ended_at_ms IS NULL AND id IS NOT :keepOpenId
    """,
  )
  suspend fun closeAbandonedRideRecordings(endedAtMs: Long, reason: String, keepOpenId: String?): Int

  @Insert
  suspend fun insertRideTrackPoints(points: List<RideTrackPointEntity>)

  /**
   * The Ride Track over a time range, on the GPS clock. Every stored fix is returned with the
   * accuracy it was reported with — filtering poor fixes is a read-side decision the caller makes,
   * not one this query bakes in.
   */
  @Query(
    """
    SELECT * FROM ride_track_points
    WHERE fix_at_ms >= :fromMs
      AND fix_at_ms <= :toMs
      AND (:boardId IS NULL OR board_id = :boardId)
    ORDER BY fix_at_ms ASC
    LIMIT :limit
    """,
  )
  suspend fun getRideTrackPoints(
    fromMs: Long,
    toMs: Long,
    boardId: String?,
    limit: Int,
  ): List<RideTrackPointEntity>

  @Query("SELECT COUNT(*) FROM ride_track_points")
  suspend fun countRideTrackPoints(): Long

  /**
   * Ride Track bounds, on the GPS clock. A rebuild covers them as well as the frame bounds: a
   * minute can hold fixes and no frame at all, and that minute still owns a bucket (ADR 0038).
   */
  @Query("SELECT MIN(fix_at_ms) FROM ride_track_points")
  suspend fun firstRideTrackAt(): Long?

  @Query("SELECT MAX(fix_at_ms) FROM ride_track_points")
  suspend fun lastRideTrackAt(): Long?

  @Query("DELETE FROM ride_track_points WHERE fix_at_ms < :beforeMs")
  suspend fun deleteRideTrackPointsBefore(beforeMs: Long): Int

  @Query(
    """
    DELETE FROM ride_track_points
    WHERE fix_at_ms >= :fromMs
      AND fix_at_ms <= :toMs
      AND (
        (:boardId IS NOT NULL AND board_id = :boardId)
        OR (:boardId IS NULL AND board_id IS NULL)
      )
    """,
  )
  suspend fun deleteRideTrackPointsRange(fromMs: Long, toMs: Long, boardId: String?): Int

  @Query("DELETE FROM ride_track_points WHERE fix_at_ms >= :fromMs AND fix_at_ms <= :toMs")
  suspend fun deleteRideTrackPointsRangeAllDevices(fromMs: Long, toMs: Long): Int

  @Query("DELETE FROM ride_track_points")
  suspend fun clearRideTrackPoints()

  /**
   * Drop closed recordings no row references any more. Identity outlives its rows only as long as
   * something can still be attributed to it, and an open recording is never pruned.
   */
  @Query(
    """
    DELETE FROM ride_recordings
    WHERE ended_at_ms IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ride_track_points p WHERE p.recording_id = ride_recordings.id)
      AND NOT EXISTS (SELECT 1 FROM telemetry_frames f WHERE f.recording_id = ride_recordings.id)
      AND NOT EXISTS (
        SELECT 1 FROM telemetry_minute_buckets b WHERE b.recording_id = ride_recordings.id
      )
    """,
  )
  suspend fun pruneOrphanRideRecordings(): Int

  @Query("DELETE FROM ride_recordings")
  suspend fun clearRideRecordings()

  @Transaction
  suspend fun upsertExclusionRanges(exclusions: List<MetricExclusionRangeEntity>) {
    for (exclusion in exclusions.sortedWith(compareBy({ it.boardId }, { it.reason }, { it.startMs }))) {
      val existing = getMergeableExclusionRange(
        exclusion.boardId,
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
    WHERE (:boardId IS NULL OR board_id = :boardId)
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
    boardId: String?,
    limit: Int,
  ): List<TelemetryMinuteBucketEntity>

  @Query("SELECT * FROM telemetry_minute_buckets ORDER BY bucket_start_ms ASC")
  suspend fun getAllHistoryBucketsAsc(): List<TelemetryMinuteBucketEntity>

  /**
   * Ride grouping reads every bucket, including the ones a Ride Track wrote with no Telemetry
   * Sample in them. A board dropout is exactly when those minutes exist, and they carry the Moving
   * Window and route anchor that keep Time and the seek timeline honest across it (ADR 0038).
   * [getHistoryBuckets] stays sample-only: its rows are graph buckets.
   */
  @Query(
    """
    SELECT * FROM telemetry_minute_buckets
    WHERE bucket_start_ms <= :beforeMs
    ORDER BY bucket_start_ms DESC
    LIMIT :limit
    """,
  )
  suspend fun getRideBuckets(beforeMs: Long, limit: Int): List<TelemetryMinuteBucketEntity>

  @Query(
    """
    SELECT * FROM telemetry_markers
    WHERE occurred_at_ms >= :fromMs
      AND occurred_at_ms <= :toMs
      AND (:boardId IS NULL OR board_id = :boardId)
    ORDER BY occurred_at_ms ASC
    """,
  )
  suspend fun getMarkers(fromMs: Long, toMs: Long, boardId: String?): List<TelemetryMarkerEntity>

  @Query(
    """
    SELECT * FROM diagnostic_events
    WHERE occurred_at_ms >= :fromMs
      AND occurred_at_ms <= :toMs
      AND (:boardId IS NULL OR board_id = :boardId)
    ORDER BY occurred_at_ms DESC
    LIMIT :limit
    """,
  )
  suspend fun getDiagnosticEvents(
    fromMs: Long,
    toMs: Long,
    boardId: String?,
    limit: Int,
  ): List<DiagnosticEventEntity>

  @Query(
    """
    SELECT * FROM telemetry_frames
    WHERE captured_at_ms <= :fromMs
      AND (:boardId IS NULL OR board_id = :boardId)
      AND (flags & :keyframeFlag) != 0
    ORDER BY captured_at_ms DESC
    LIMIT 1
    """,
  )
  suspend fun getLatestKeyframeBefore(
    fromMs: Long,
    boardId: String?,
    keyframeFlag: Int = TELEMETRY_FLAG_KEYFRAME,
  ): TelemetryFrameEntity?

  @Query(
    """
    SELECT * FROM telemetry_frames
    WHERE captured_at_ms >= :fromMs
      AND captured_at_ms <= :toMs
      AND (:boardId IS NULL OR board_id = :boardId)
    ORDER BY captured_at_ms ASC
    LIMIT :limit
    """,
  )
  suspend fun getFrames(fromMs: Long, toMs: Long, boardId: String?, limit: Int): List<TelemetryFrameEntity>

  @Query(
    """
    SELECT DISTINCT board_id FROM telemetry_frames
    WHERE captured_at_ms >= :fromMs
      AND captured_at_ms <= :toMs
      AND board_id IS NOT NULL
    ORDER BY board_id ASC
    """,
  )
  suspend fun getBoardIdsInRange(fromMs: Long, toMs: Long): List<String>

  @Query(
    """
    SELECT * FROM telemetry_frames
    WHERE captured_at_ms >= :fromMs
      AND captured_at_ms <= :toMs
      AND board_id = :boardId
    ORDER BY captured_at_ms ASC
    LIMIT 1
    """,
  )
  suspend fun getFirstFrameInRange(
    fromMs: Long,
    toMs: Long,
    boardId: String,
  ): TelemetryFrameEntity?

  @Query("SELECT COUNT(*) FROM telemetry_frames")
  suspend fun countFrames(): Long

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
    deleteRideTrackPointsBefore(beforeMs)
    pruneOrphanRideRecordings()
    return frames
  }

  @Query(
    """
    DELETE FROM telemetry_frames
    WHERE captured_at_ms >= :fromMs
      AND captured_at_ms <= :toMs
      AND (
        (:boardId IS NOT NULL AND board_id = :boardId)
        OR (:boardId IS NULL AND board_id IS NULL)
      )
    """,
  )
  suspend fun deleteFramesRange(fromMs: Long, toMs: Long, boardId: String?): Int

  @Query(
    """
    DELETE FROM telemetry_markers
    WHERE occurred_at_ms >= :fromMs
      AND occurred_at_ms <= :toMs
      AND (
        (:boardId IS NOT NULL AND board_id = :boardId)
        OR (:boardId IS NULL AND board_id IS NULL)
      )
    """,
  )
  suspend fun deleteMarkersRange(fromMs: Long, toMs: Long, boardId: String?): Int

  @Query(
    """
    DELETE FROM telemetry_minute_buckets
    WHERE last_sample_at_ms >= :fromMs
      AND first_sample_at_ms <= :toMs
      AND board_id = :bucketBoardId
    """,
  )
  suspend fun deleteBucketsRange(fromMs: Long, toMs: Long, bucketBoardId: String): Int

  /** Every telemetry table keys on [boardId] (ADR 0028). Null means "every Board". */
  @Transaction
  suspend fun deleteRange(fromMs: Long, toMs: Long, boardId: String?): Int {
    val frames = deleteFramesRange(fromMs, toMs, boardId)
    deleteMarkersRange(fromMs, toMs, boardId)
    deleteBucketsRange(fromMs, toMs, boardId ?: UNKNOWN_TELEMETRY_BOARD_ID)
    deleteExclusionsRange(fromMs, toMs)
    deleteRideTrackPointsRange(fromMs, toMs, boardId)
    pruneOrphanRideRecordings()
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
    deleteRideTrackPointsRangeAllDevices(fromMs, toMs)
    pruneOrphanRideRecordings()
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
    clearRideTrackPoints()
    clearRideRecordings()
  }

  /** Live Boards only — a tombstoned Board is gone from every Rider-facing list (ADR 0027). */
  @Query("SELECT * FROM boards WHERE deleted_at IS NULL ORDER BY created_at ASC")
  suspend fun getBoards(): List<BoardEntity>

  /**
   * Resolves tombstones too, deliberately: Ride History still has to name a deleted Board. Callers
   * that act on a Board rather than describe one check [BoardEntity.deletedAt] and refuse.
   */
  @Query("SELECT * FROM boards WHERE id = :id LIMIT 1")
  suspend fun getBoard(id: String): BoardEntity?

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun insertBoardRow(board: BoardEntity)

  @Query("SELECT deleted_at FROM boards WHERE id = :id")
  suspend fun getBoardDeletedAt(id: String): Long?

  /**
   * An existing tombstone survives the write, so an ordinary upsert can never resurrect a deleted
   * Board — deletion is terminal (ADR 0027). Only [deleteBoardWithSettings] stamps a new one.
   */
  @Transaction
  suspend fun upsertBoard(board: BoardEntity) {
    insertBoardRow(board.copy(deletedAt = board.deletedAt ?: getBoardDeletedAt(board.id)))
  }

  /**
   * Every Board including tombstones, for Ride History name resolution. Names are looked up on read
   * rather than denormalized onto telemetry rows (ADR 0028), so a rename retroactively relabels the
   * history and a deleted Board is still nameable.
   */
  @Query("SELECT id, name FROM boards")
  suspend fun getBoardNames(): List<BoardNameRow>

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

  /**
   * The Rider-facing delete: configuration goes, the Board row stays as a tombstone (ADR 0027).
   * Telemetry and Tune Profiles are untouched — both outlive the Board.
   *
   * An unknown or already-tombstoned id is a no-op.
   */
  @Transaction
  suspend fun deleteBoardWithSettings(id: String, deletedAt: Long) {
    val board = getBoard(id)?.takeIf { it.deletedAt == null } ?: return
    deleteBoardSettings(id)
    deleteBoardWarnings(id)
    // Alert Rules are Board-owned (#254) — drop them with the Board so no orphan rows survive.
    deleteAlertRules(id)
    insertBoardRow(board.copy(deletedAt = deletedAt))
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

  @Query("SELECT * FROM vesc_fault_occurrences WHERE board_id = :boardId ORDER BY occurred_at DESC, rowid DESC")
  suspend fun getVescFaults(boardId: String): List<VescFaultOccurrenceEntity>

  @Query("SELECT * FROM vesc_fault_occurrences ORDER BY board_id ASC, occurred_at DESC, rowid DESC")
  suspend fun getAllVescFaults(): List<VescFaultOccurrenceEntity>

  @Query("SELECT * FROM vesc_fault_occurrences WHERE id = :id LIMIT 1")
  suspend fun getVescFault(id: String): VescFaultOccurrenceEntity?

  /** Newest still-open occurrence for a Board — rehydrates coordinator state after restart. */
  @Query(
    "SELECT * FROM vesc_fault_occurrences WHERE board_id = :boardId AND cleared_at IS NULL " +
      "ORDER BY occurred_at DESC, rowid DESC LIMIT 1",
  )
  suspend fun getOpenVescFault(boardId: String): VescFaultOccurrenceEntity?

  @Insert(onConflict = OnConflictStrategy.IGNORE)
  suspend fun insertVescFault(fault: VescFaultOccurrenceEntity): Long

  @Query(
    "UPDATE vesc_fault_occurrences SET last_observed_at = :lastObservedAt, cleared_at = :clearedAt WHERE id = :id",
  )
  suspend fun updateVescFaultLifecycle(
    id: String,
    lastObservedAt: Long,
    clearedAt: Long?,
  )

  /**
   * Insert-or-advance. Deliberately not a `REPLACE` upsert: that rewrites `dismissed` from the
   * caller's in-memory snapshot, so a stale heartbeat could un-dismiss what the rider just
   * acknowledged. Dismissal has its own statement.
   */
  @Transaction
  suspend fun upsertVescFault(fault: VescFaultOccurrenceEntity) {
    if (insertVescFault(fault) == -1L) {
      updateVescFaultLifecycle(fault.id, fault.lastObservedAtMs, fault.clearedAtMs)
    }
  }

  @Query("UPDATE vesc_fault_occurrences SET dismissed = :dismissed WHERE id = :id")
  suspend fun setVescFaultDismissed(id: String, dismissed: Boolean): Int

  // VESC Fault Captures — one self-contained window of decoded Board samples per occurrence. Append
  // only, no GPS, and outside every Ride History retention/pruning path.
  // @parity /modules/vescape-core/ios/faults/VescFaultCaptureStore.swift

  @Upsert
  suspend fun upsertVescFaultCapture(capture: VescFaultCaptureEntity)

  @Query("SELECT * FROM vesc_fault_captures WHERE occurrence_id = :occurrenceId LIMIT 1")
  suspend fun getVescFaultCapture(occurrenceId: String): VescFaultCaptureEntity?

  @Insert
  suspend fun insertVescFaultCaptureSamples(samples: List<VescFaultCaptureSampleEntity>)

  @Query(
    "SELECT * FROM vesc_fault_capture_samples WHERE occurrence_id = :occurrenceId " +
      "ORDER BY captured_at ASC, id ASC",
  )
  suspend fun getVescFaultCaptureSamples(occurrenceId: String): List<VescFaultCaptureSampleEntity>

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

  /**
   * Patch a few fields of the stored baseline in one transaction, leaving every other field and the
   * row's `capturedAt` alone.
   *
   * A runtime command that mutates config on the board has to teach the baseline about it, but it
   * holds a snapshot taken when the session read ran — writing that whole snapshot back would undo a
   * fresh read that landed in between and resurrect its stale values as the comparison base.
   */
  @Transaction
  suspend fun patchBoardConfigValues(
    boardId: String,
    refloatBaseVersion: String,
    patch: (BoardConfigValuesEntity) -> BoardConfigValuesEntity,
  ) {
    val row = getBoardConfigValues(boardId, refloatBaseVersion) ?: return
    upsertBoardConfigValues(patch(row))
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
