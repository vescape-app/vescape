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
  suspend fun insertPrivacyZoneRow(zone: PrivacyZoneEntity)

  @Query("SELECT updated_at FROM privacy_zones WHERE id = :id")
  suspend fun getPrivacyZoneUpdatedAt(id: String): Long?

  /** Stamps both sync columns; see [upsertBoard]. */
  @Transaction
  suspend fun upsertPrivacyZone(zone: PrivacyZoneEntity) {
    insertPrivacyZoneRow(
      zone.copy(
        updatedAt = ratchetUpdatedAt(getPrivacyZoneUpdatedAt(zone.id), zone.updatedAt),
        syncSeq = nextSyncSeq(SYNC_SEQ_PRIVACY_ZONES),
      ),
    )
  }

  /** Targeted toggle that bypasses the upsert, so it moves both columns itself; see
   * [setAlertRuleEnabledRow]. */
  @Query(
    "UPDATE privacy_zones SET enabled = :enabled, updated_at = MAX(updated_at + 1, :updatedAt), " +
      "sync_seq = :syncSeq WHERE id = :id",
  )
  suspend fun setPrivacyZoneEnabledRow(id: String, enabled: Boolean, updatedAt: Long, syncSeq: Long)

  @Transaction
  suspend fun setPrivacyZoneEnabled(id: String, enabled: Boolean, updatedAt: Long) {
    setPrivacyZoneEnabledRow(id, enabled, updatedAt, nextSyncSeq(SYNC_SEQ_PRIVACY_ZONES))
  }

  @Query("DELETE FROM privacy_zones WHERE id = :id")
  suspend fun deletePrivacyZoneRow(id: String)

  /** Semantic removal: the Rider deleted the zone, so the server has to lose it too. */
  @Transaction
  suspend fun deletePrivacyZone(id: String) {
    appendDeleteAction(DeleteTarget.PRIVACY_ZONE, null, id, getPrivacyZoneUpdatedAt(id))
    deletePrivacyZoneRow(id)
  }


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

  @Query("SELECT * FROM telemetry_minute_buckets WHERE bucket_start_ms = :bucketStartMs AND board_id = :boardId LIMIT 1")
  suspend fun getBucket(bucketStartMs: Long, boardId: String): TelemetryMinuteBucketEntity?

  @Transaction
  suspend fun upsertBuckets(buckets: Collection<TelemetryMinuteBucketEntity>) {
    for (bucket in buckets) {
      // A merge rewrites a row the scan may already have passed, so the seq moves on both branches.
      val next = bucket.copy(syncSeq = nextSyncSeq(SYNC_SEQ_MINUTE_BUCKETS))
      val existing = getBucket(next.bucketStartMs, next.boardId)
      if (existing == null) {
        insertBucket(next)
      } else {
        updateBucket(existing.merge(next))
      }
    }
  }

  @Query("INSERT OR IGNORE INTO sync_sequences (name, last_value) VALUES (:name, 0)")
  suspend fun seedSyncSequence(name: String)

  @Query("UPDATE sync_sequences SET last_value = last_value + 1 WHERE name = :name")
  suspend fun bumpSyncSequence(name: String)

  @Query("SELECT last_value FROM sync_sequences WHERE name = :name")
  suspend fun getSyncSequence(name: String): Long?

  /**
   * Hands out the next Sync Cursor position for [name]. Bump-then-read rather than read-then-bump so
   * two writes racing inside the same database can never be handed the same number; both statements
   * run in the caller's transaction.
   *
   * Seeds the row first because a fresh install builds the schema from the entities and never runs
   * the migration that inserts it.
   */
  @Transaction
  suspend fun nextSyncSeq(name: String): Long {
    seedSyncSequence(name)
    bumpSyncSequence(name)
    return getSyncSequence(name) ?: 0L
  }

  // Sync Actions — the append-only log of semantic removals (#282). Every write below runs inside
  // the caller's transaction, so an action and the delete it describes commit together or not at all.
  // @parity /modules/vescape-core/ios/telemetry/SyncActionLog.swift

  @Insert
  suspend fun insertSyncAction(action: SyncActionEntity): Long

  /**
   * Record that [target] identified by [boardId]/[key] was semantically removed.
   *
   * [rowUpdatedAt] is the removed row's own last-write-wins timestamp, read before the delete: the
   * action is stamped `max(now, rowUpdatedAt)` so a rewound device clock cannot produce an action
   * the server reads as older than the row it names — that action would be dropped as a no-op, and
   * the phone could not self-heal by re-sending, because the row is gone.
   *
   * A null [rowUpdatedAt] means there was no row to remove, so no intent to record either.
   */
  @Transaction
  suspend fun appendDeleteAction(
    target: DeleteTarget,
    boardId: String?,
    key: String,
    rowUpdatedAt: Long?,
    now: Long = System.currentTimeMillis(),
  ) {
    if (rowUpdatedAt == null) return
    insertSyncAction(
      SyncActionEntity(
        target = target.wire,
        boardId = boardId,
        key = key,
        deletedAt = maxOf(now, rowUpdatedAt),
      ),
    )
  }

  /** The next page of actions to upload, in cursor order. */
  @Query("SELECT * FROM sync_actions WHERE id > :afterId ORDER BY id ASC LIMIT :limit")
  suspend fun getSyncActionsAfter(afterId: Long, limit: Int): List<SyncActionEntity>

  @Query(
    "INSERT OR REPLACE INTO sync_sequences (name, last_value) VALUES (:name, " +
      "MAX(:value, COALESCE((SELECT last_value FROM sync_sequences WHERE name = :name), 0)))",
  )
  suspend fun commitSyncActionCursorRow(name: String, value: Long)

  /**
   * Checkpoint the highest action cursor the server has accepted. Its own transaction, committed
   * before [pruneUploadedSyncActions] runs: a crash between the two leaves rows that will be sent
   * again — harmless, since applying an action twice is a no-op — whereas pruning first would drop
   * an action nobody has accepted. Never moves backwards, so an out-of-order commit cannot un-accept
   * what an earlier upload already checkpointed.
   */
  @Transaction
  suspend fun commitSyncActionCursor(throughId: Long) =
    commitSyncActionCursorRow(SYNC_ACTIONS_UPLOADED_CURSOR, throughId)

  @Query("DELETE FROM sync_actions WHERE id <= :throughId")
  suspend fun deleteSyncActionsThrough(throughId: Long): Int

  /**
   * Drop what the server has already accepted. Gated on the committed cursor rather than a caller's
   * number, so pruning structurally cannot outrun the checkpoint.
   */
  @Transaction
  suspend fun pruneUploadedSyncActions(): Int {
    val accepted = getSyncSequence(SYNC_ACTIONS_UPLOADED_CURSOR) ?: return 0
    return deleteSyncActionsThrough(accepted)
  }

  // Sync Cursors — the uploader's forward scan (#284). Mutable tables scan on `sync_seq`,
  // append-only tables on their `AUTOINCREMENT` key; both are device-local counters that never
  // cross the wire.
  // @parity /modules/vescape-core/ios/sync/SyncStore.swift

  /**
   * Checkpoint how far [name] has been accepted. Its own transaction, run after the response and
   * never alongside the rows: a cursor advanced past rows the server did not take is unrecoverable,
   * whereas a cursor left behind is a re-send the server upserts idempotently. Never moves
   * backwards, so an out-of-order commit cannot un-accept an earlier one.
   */
  @Transaction
  suspend fun commitSyncCursor(name: String, throughValue: Long) =
    commitSyncActionCursorRow(name, throughValue)

  @Query("SELECT * FROM app_settings WHERE sync_seq > :cursor ORDER BY sync_seq ASC LIMIT :limit")
  suspend fun getAppSettingsAfter(cursor: Long, limit: Int): List<AppSettingEntity>

  @Query("SELECT * FROM boards WHERE sync_seq > :cursor ORDER BY sync_seq ASC LIMIT :limit")
  suspend fun getBoardsAfter(cursor: Long, limit: Int): List<BoardEntity>

  @Query("SELECT * FROM board_settings WHERE sync_seq > :cursor ORDER BY sync_seq ASC LIMIT :limit")
  suspend fun getBoardSettingsAfter(cursor: Long, limit: Int): List<BoardSettingEntity>

  @Query("SELECT * FROM board_warnings WHERE sync_seq > :cursor ORDER BY sync_seq ASC LIMIT :limit")
  suspend fun getBoardWarningsAfter(cursor: Long, limit: Int): List<BoardWarningEntity>

  @Query("SELECT * FROM alerts WHERE sync_seq > :cursor ORDER BY sync_seq ASC LIMIT :limit")
  suspend fun getAlertsAfter(cursor: Long, limit: Int): List<AlertRuleEntity>

  @Query("SELECT * FROM tune_profiles WHERE sync_seq > :cursor ORDER BY sync_seq ASC LIMIT :limit")
  suspend fun getTuneProfilesAfter(cursor: Long, limit: Int): List<TuneProfileEntity>

  @Query("SELECT * FROM tune_history_entries WHERE id > :cursor ORDER BY id ASC LIMIT :limit")
  suspend fun getTuneHistoryEntriesAfter(cursor: Long, limit: Int): List<TuneHistoryEntryEntity>

  @Query("SELECT * FROM privacy_zones WHERE sync_seq > :cursor ORDER BY sync_seq ASC LIMIT :limit")
  suspend fun getPrivacyZonesAfter(cursor: Long, limit: Int): List<PrivacyZoneEntity>

  @Query("SELECT * FROM telemetry_markers WHERE id > :cursor ORDER BY id ASC LIMIT :limit")
  suspend fun getTelemetryMarkersAfter(cursor: Long, limit: Int): List<TelemetryMarkerEntity>

  @Query("SELECT * FROM metric_exclusion_ranges WHERE id > :cursor ORDER BY id ASC LIMIT :limit")
  suspend fun getExclusionRangesAfter(cursor: Long, limit: Int): List<MetricExclusionRangeEntity>

  @Query("SELECT * FROM diagnostic_events WHERE id > :cursor ORDER BY id ASC LIMIT :limit")
  suspend fun getDiagnosticEventsAfter(cursor: Long, limit: Int): List<DiagnosticEventEntity>

  /**
   * Frames that name no Board cannot be uploaded — the server keys this table on the Board and has
   * nowhere to put a sample that belongs to none (ADR-0028) — so the scan does not offer them and
   * the cursor moves over them. They are unowned local rows, not rows a Rider is waiting to see
   * backed up.
   *
   * The consequence is deliberate: a later owned frame carries the cursor past a skipped one, so
   * cursor-gated retention prunes unowned telemetry on age alone, exactly as it did before the
   * Account binding existed. Holding it forever would be the only alternative, because no future
   * upload can ever accept it.
   */
  @Query(
    "SELECT * FROM telemetry_frames WHERE id > :cursor AND board_id IS NOT NULL " +
      "ORDER BY id ASC LIMIT :limit",
  )
  suspend fun getTelemetryFramesAfter(cursor: Long, limit: Int): List<TelemetryFrameEntity>

  /** Buckets whose Board is the unknown-Board sentinel are unowned in the same way as a frame. */
  @Query(
    "SELECT * FROM telemetry_minute_buckets WHERE sync_seq > :cursor AND board_id != '' " +
      "ORDER BY sync_seq ASC LIMIT :limit",
  )
  suspend fun getMinuteBucketsAfter(cursor: Long, limit: Int): List<TelemetryMinuteBucketEntity>

  @Query("SELECT * FROM favorites WHERE sync_seq > :cursor ORDER BY sync_seq ASC LIMIT :limit")
  suspend fun getFavoritesAfter(cursor: Long, limit: Int): List<FavoriteEntity>

  @Query("SELECT COUNT(*) FROM app_settings WHERE sync_seq > :cursor")
  suspend fun countAppSettingsAfter(cursor: Long): Int

  @Query("SELECT COUNT(*) FROM boards WHERE sync_seq > :cursor")
  suspend fun countBoardsAfter(cursor: Long): Int

  @Query("SELECT COUNT(*) FROM board_settings WHERE sync_seq > :cursor")
  suspend fun countBoardSettingsAfter(cursor: Long): Int

  @Query("SELECT COUNT(*) FROM board_warnings WHERE sync_seq > :cursor")
  suspend fun countBoardWarningsAfter(cursor: Long): Int

  @Query("SELECT COUNT(*) FROM alerts WHERE sync_seq > :cursor")
  suspend fun countAlertsAfter(cursor: Long): Int

  @Query("SELECT COUNT(*) FROM tune_profiles WHERE sync_seq > :cursor")
  suspend fun countTuneProfilesAfter(cursor: Long): Int

  @Query("SELECT COUNT(*) FROM tune_history_entries WHERE id > :cursor")
  suspend fun countTuneHistoryEntriesAfter(cursor: Long): Int

  @Query("SELECT COUNT(*) FROM privacy_zones WHERE sync_seq > :cursor")
  suspend fun countPrivacyZonesAfter(cursor: Long): Int

  @Query("SELECT COUNT(*) FROM telemetry_markers WHERE id > :cursor")
  suspend fun countTelemetryMarkersAfter(cursor: Long): Int

  @Query("SELECT COUNT(*) FROM metric_exclusion_ranges WHERE id > :cursor")
  suspend fun countExclusionRangesAfter(cursor: Long): Int

  @Query("SELECT COUNT(*) FROM diagnostic_events WHERE id > :cursor")
  suspend fun countDiagnosticEventsAfter(cursor: Long): Int

  @Query("SELECT COUNT(*) FROM telemetry_frames WHERE id > :cursor AND board_id IS NOT NULL")
  suspend fun countTelemetryFramesAfter(cursor: Long): Int

  @Query("SELECT COUNT(*) FROM telemetry_minute_buckets WHERE sync_seq > :cursor AND board_id != ''")
  suspend fun countMinuteBucketsAfter(cursor: Long): Int

  @Query("SELECT COUNT(*) FROM favorites WHERE sync_seq > :cursor")
  suspend fun countFavoritesAfter(cursor: Long): Int

  @Query("SELECT COUNT(*) FROM sync_actions WHERE id > :cursor")
  suspend fun countSyncActionsAfter(cursor: Long): Int

  // Account binding — which Vescape Account this local database belongs to (#284). One row, so a
  // database replaced on an Account change starts unbound with no cursors and no actions.

  @Query("SELECT account_id FROM sync_binding WHERE id = 0")
  suspend fun getBoundAccountId(): String?

  @Query("INSERT OR REPLACE INTO sync_binding (id, account_id, bound_at) VALUES (0, :accountId, :boundAt)")
  suspend fun bindAccountRow(accountId: String, boundAt: Long)

  /**
   * Claim this database for [accountId], or confirm it already belongs to it. Returns false when it
   * belongs to a different Account: the caller has to replace the database first, because resetting
   * the cursors over these rows would upload the previous Account's data to the new one.
   */
  @Transaction
  suspend fun bindAccount(accountId: String, now: Long = System.currentTimeMillis()): Boolean {
    val bound = getBoundAccountId()
    if (bound != null) return bound == accountId
    bindAccountRow(accountId, now)
    return true
  }

  // Cursor-gated retention (#284). A retention cutoff is only a candidate cutoff: cleanup must not
  // remove a row the uploader has not delivered. Each sweep reads its table cursor and deletes in
  // one transaction, so racing an upload fails safe — before the cursor commit the rows are
  // retained, after it the server has accepted them. A missing cursor is 0, protecting every row.

  @Query("DELETE FROM telemetry_frames WHERE captured_at_ms < :beforeMs AND id <= :cursor")
  suspend fun deleteFramesBeforeUpTo(beforeMs: Long, cursor: Long): Int

  @Query("DELETE FROM telemetry_markers WHERE occurred_at_ms < :beforeMs AND id <= :cursor")
  suspend fun deleteMarkersBeforeUpTo(beforeMs: Long, cursor: Long): Int

  @Query("DELETE FROM telemetry_minute_buckets WHERE bucket_start_ms < :beforeMs AND sync_seq <= :cursor")
  suspend fun deleteBucketsBeforeUpTo(beforeMs: Long, cursor: Long): Int

  @Query("DELETE FROM diagnostic_events WHERE occurred_at_ms < :beforeMs AND id <= :cursor")
  suspend fun deleteDiagnosticEventsBeforeUpTo(beforeMs: Long, cursor: Long): Int

  @Query("DELETE FROM metric_exclusion_ranges WHERE end_ms < :beforeMs AND id <= :cursor")
  suspend fun deleteExclusionsBeforeUpTo(beforeMs: Long, cursor: Long): Int

  /**
   * Age-only cleanup while the database has never been bound to an Account, and age plus the
   * accepted Sync Cursor once it has. Emits no Sync Actions — a retention sweep is maintenance, and
   * `DeleteTarget` has no case that could name a pruned table.
   */
  @Transaction
  suspend fun deleteBeforeGated(beforeMs: Long): Int {
    if (getBoundAccountId() == null) return deleteBefore(beforeMs)
    val frames = deleteFramesBeforeUpTo(beforeMs, cursorOf(SYNC_CURSOR_FRAMES))
    deleteMarkersBeforeUpTo(beforeMs, cursorOf(SYNC_CURSOR_MARKERS))
    deleteBucketsBeforeUpTo(beforeMs, cursorOf(SYNC_CURSOR_MINUTE_BUCKETS))
    deleteDiagnosticEventsBeforeUpTo(beforeMs, cursorOf(SYNC_CURSOR_DIAGNOSTIC_EVENTS))
    deleteExclusionsBeforeUpTo(beforeMs, cursorOf(SYNC_CURSOR_EXCLUSION_RANGES))
    return frames
  }

  /** A table with no committed cursor has delivered nothing, so none of its rows may be pruned. */
  suspend fun cursorOf(name: String): Long = getSyncSequence(name) ?: 0L

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

  @Query("SELECT updated_at FROM boards WHERE id = :id")
  suspend fun getBoardUpdatedAt(id: String): Long?

  @Query("SELECT deleted_at FROM boards WHERE id = :id")
  suspend fun getBoardDeletedAt(id: String): Long?

  /**
   * Stamps both sync columns before the row lands: a fresh `sync_seq` so the upload scan sees this
   * write, and a ratcheted `updated_at` so the server keeps it. Caller-supplied values for either
   * are overwritten — see [SyncSequenceEntity] and [BoardEntity.updatedAt].
   *
   * An existing tombstone survives the write, so an ordinary upsert can never resurrect a deleted
   * Board — deletion is terminal (ADR 0027). Only [deleteBoardWithSettings] stamps a new one.
   */
  @Transaction
  suspend fun upsertBoard(board: BoardEntity) {
    insertBoardRow(
      board.copy(
        updatedAt = ratchetUpdatedAt(getBoardUpdatedAt(board.id), board.updatedAt),
        syncSeq = nextSyncSeq(SYNC_SEQ_BOARDS),
        deletedAt = board.deletedAt ?: getBoardDeletedAt(board.id),
      ),
    )
  }

  /**
   * Every Board including tombstones, for Ride History name resolution. Names are looked up on read
   * rather than denormalized onto telemetry rows (ADR 0028), so a rename retroactively relabels the
   * history and a deleted Board is still nameable.
   */
  @Query("SELECT id, name FROM boards")
  suspend fun getBoardNames(): List<BoardNameRow>

  /** The BLE identifier a Board currently claims, for the tables still keyed on it. */
  @Query("SELECT ble_id FROM boards WHERE id = :id LIMIT 1")
  suspend fun getBoardBleId(id: String): String?

  @Query("SELECT * FROM board_settings WHERE board_id = :boardId")
  suspend fun getBoardSettings(boardId: String): List<BoardSettingEntity>

  @Query("SELECT * FROM board_settings WHERE board_id IN (:boardIds)")
  suspend fun getBoardSettings(boardIds: List<String>): List<BoardSettingEntity>

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun insertBoardSettingRow(setting: BoardSettingEntity)

  @Query("SELECT updated_at FROM board_settings WHERE board_id = :boardId AND key = :key")
  suspend fun getBoardSettingUpdatedAt(boardId: String, key: String): Long?

  /** Stamps both sync columns; see [upsertBoard]. */
  @Transaction
  suspend fun upsertBoardSetting(setting: BoardSettingEntity) {
    insertBoardSettingRow(
      setting.copy(
        updatedAt = ratchetUpdatedAt(
          getBoardSettingUpdatedAt(setting.boardId, setting.key),
          setting.updatedAt,
        ),
        syncSeq = nextSyncSeq(SYNC_SEQ_BOARD_SETTINGS),
      ),
    )
  }

  @Query("DELETE FROM board_settings WHERE board_id = :boardId AND key = :key")
  suspend fun deleteBoardSettingRow(boardId: String, key: String)

  /**
   * Semantic removal: a Board edit that drops a key is the Rider clearing that setting, so a restore
   * must not resurrect the old value.
   */
  @Transaction
  suspend fun deleteBoardSetting(boardId: String, key: String) {
    appendDeleteAction(
      DeleteTarget.BOARD_SETTING,
      boardId,
      key,
      getBoardSettingUpdatedAt(boardId, key),
    )
    deleteBoardSettingRow(boardId, key)
  }

  @Transaction
  suspend fun upsertBoardWithSettings(board: BoardEntity, settings: List<BoardSettingEntity>, deletedKeys: List<String>) {
    upsertBoard(board)
    deletedKeys.forEach { deleteBoardSetting(board.id, it) }
    settings.forEach { upsertBoardSetting(it) }
  }

  /** Parent-covered cascade: raw, because the Board's own action covers its configuration. */
  @Query("DELETE FROM board_settings WHERE board_id = :boardId")
  suspend fun deleteBoardSettingsRaw(boardId: String)

  /**
   * The Rider-facing delete: configuration goes, the Board row stays as a tombstone (ADR 0027).
   * Telemetry and Tune Profiles are untouched — both outlive the Board.
   *
   * The tombstone is an ordinary write, so it runs through [upsertBoard] and moves both sync
   * columns like any other edit. An unknown or already-tombstoned id is a no-op.
   *
   * The tombstone syncs as an ordinary upsert *and* emits one Sync Action, because the two say
   * different things: the row says the Board is deleted, the action says its configuration is gone.
   * Keeping the cascade an explicit, replay-safe action is what stops a dumb upsert from quietly
   * deleting rows in three other tables. The children are raw deletes — the Board's action covers
   * them (#282).
   *
   * The action and the tombstone share one timestamp, the newly ratcheted `updated_at`, so the
   * server judges both against the same moment.
   */
  @Transaction
  suspend fun deleteBoardWithSettings(id: String, deletedAt: Long) {
    val board = getBoard(id)?.takeIf { it.deletedAt == null } ?: return
    val tombstonedAt = ratchetUpdatedAt(board.updatedAt, deletedAt)
    deleteBoardSettingsRaw(id)
    deleteBoardWarningsRaw(id)
    // Alert Rules are Board-owned (#254) — drop them with the Board so no orphan rows survive.
    deleteAlertRulesRaw(id)
    appendDeleteAction(DeleteTarget.BOARD, null, id, tombstonedAt, tombstonedAt)
    upsertBoard(board.copy(deletedAt = tombstonedAt, updatedAt = tombstonedAt))
  }

  @Query("SELECT * FROM alerts WHERE board_id = :boardId ORDER BY created_at ASC")
  suspend fun getAlertRules(boardId: String): List<AlertRuleEntity>

  @Query("SELECT * FROM alerts WHERE board_id = :boardId AND enabled = 1 ORDER BY created_at ASC")
  suspend fun getEnabledAlertRules(boardId: String): List<AlertRuleEntity>

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun insertAlertRuleRow(rule: AlertRuleEntity)

  @Query("SELECT updated_at FROM alerts WHERE board_id = :boardId AND id = :id")
  suspend fun getAlertRuleUpdatedAt(boardId: String, id: String): Long?

  /** Stamps both sync columns; see [upsertBoard]. */
  @Transaction
  suspend fun upsertAlertRule(rule: AlertRuleEntity) {
    insertAlertRuleRow(
      rule.copy(
        updatedAt = ratchetUpdatedAt(getAlertRuleUpdatedAt(rule.boardId, rule.id), rule.updatedAt),
        syncSeq = nextSyncSeq(SYNC_SEQ_ALERTS),
      ),
    )
  }

  /**
   * Targeted toggle. Unlike the `@Insert` upserts it never round-trips an entity, so both sync
   * columns have to move here explicitly — without them, toggling a rule leaves it invisible to the
   * upload scan and the change never reaches the server.
   *
   * The `MAX(updated_at + 1, :updatedAt)` fold is the same ratchet [upsertBoard] applies, expressed
   * in SQL because the row is already being read by the `WHERE`.
   */
  @Query(
    "UPDATE alerts SET enabled = :enabled, updated_at = MAX(updated_at + 1, :updatedAt), " +
      "sync_seq = :syncSeq WHERE board_id = :boardId AND id = :id",
  )
  suspend fun setAlertRuleEnabledRow(
    boardId: String,
    id: String,
    enabled: Boolean,
    updatedAt: Long,
    syncSeq: Long,
  )

  /** @parity /modules/vescape-core/ios/telemetry/AppDataRepository.swift `setAlertRuleEnabled` */
  @Transaction
  suspend fun setAlertRuleEnabled(boardId: String, id: String, enabled: Boolean, updatedAt: Long) {
    setAlertRuleEnabledRow(boardId, id, enabled, updatedAt, nextSyncSeq(SYNC_SEQ_ALERTS))
  }

  @Query("DELETE FROM alerts WHERE board_id = :boardId AND id = :id")
  suspend fun deleteAlertRuleRow(boardId: String, id: String)

  /**
   * Semantic removal, and the path preset regeneration takes too: JS regenerates a Board's preset
   * rules by deleting the old ones and writing new ones, and the deleted ones have to disappear
   * server-side as well.
   */
  @Transaction
  suspend fun deleteAlertRule(boardId: String, id: String) {
    appendDeleteAction(DeleteTarget.ALERT, boardId, id, getAlertRuleUpdatedAt(boardId, id))
    deleteAlertRuleRow(boardId, id)
  }

  /** Parent-covered cascade: raw, because the Board's own action covers its Alert Rules. */
  @Query("DELETE FROM alerts WHERE board_id = :boardId")
  suspend fun deleteAlertRulesRaw(boardId: String)

  @Query("SELECT * FROM app_settings")
  suspend fun getAllAppSettings(): List<AppSettingEntity>

  @Query("SELECT * FROM app_settings WHERE key = :key LIMIT 1")
  suspend fun getAppSetting(key: String): AppSettingEntity?

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun insertAppSettingRow(setting: AppSettingEntity)

  @Query("SELECT updated_at FROM app_settings WHERE key = :key")
  suspend fun getAppSettingUpdatedAt(key: String): Long?

  /**
   * Stamps both sync columns like [upsertBoard], except for the phone-local keys in
   * [NOT_SYNCED_SETTING_KEYS]: those keep `sync_seq` at 0, which sits below every Sync Cursor, so
   * the upload scan never picks the row up and the key stays on this phone (#277).
   */
  @Transaction
  suspend fun upsertAppSetting(setting: AppSettingEntity) {
    val phoneLocal = setting.key in NOT_SYNCED_SETTING_KEYS
    insertAppSettingRow(
      setting.copy(
        updatedAt = ratchetUpdatedAt(getAppSettingUpdatedAt(setting.key), setting.updatedAt),
        syncSeq = if (phoneLocal) 0L else nextSyncSeq(SYNC_SEQ_APP_SETTINGS),
      ),
    )
  }

  @Query("DELETE FROM app_settings WHERE key = :key")
  suspend fun deleteAppSettingRow(key: String)

  /**
   * Semantic removal. Every caller means the same thing — the stored override is gone: an edit back
   * to the default, `legalPolicy` resolving to nothing, and the corrupt-value cleanup in
   * [AppDataRepository.getTypedSettings], which is deliberately semantic so a restore cannot
   * resurrect a value this phone already rejected.
   *
   * Phone-local keys never reach the server (they carry `sync_seq = 0`), so removing one records no
   * action either — an action for a row the server never held would delete nothing and say nothing.
   */
  @Transaction
  suspend fun deleteAppSetting(key: String) {
    if (key !in NOT_SYNCED_SETTING_KEYS) {
      appendDeleteAction(DeleteTarget.APP_SETTING, null, key, getAppSettingUpdatedAt(key))
    }
    deleteAppSettingRow(key)
  }

  // Tune Profile / Tune History DAO. Transactional bodies below are mirrored in Swift.
  // @parity /modules/vescape-core/ios/telemetry/TuneProfileStore.swift
  @Query("SELECT * FROM tune_profiles WHERE board_id = :boardId AND refloat_base_version = :refloatBaseVersion ORDER BY created_at ASC")
  suspend fun getTuneProfilesByBoard(boardId: String, refloatBaseVersion: String): List<TuneProfileEntity>

  @Query("SELECT * FROM tune_profiles WHERE id = :id LIMIT 1")
  suspend fun getTuneProfile(id: String): TuneProfileEntity?

  @Query("DELETE FROM tune_profiles WHERE id = :id")
  suspend fun deleteTuneProfileRow(id: String)

  /** Parent-covered cascade: raw, because the profile's own action covers its Tune History. */
  @Query("DELETE FROM tune_history_entries WHERE profile_id = :profileId")
  suspend fun deleteTuneHistoryForProfileRaw(profileId: String)

  /** Targeted rename that bypasses the upsert, so it moves both columns itself; see
   * [setAlertRuleEnabledRow]. */
  @Query(
    "UPDATE tune_profiles SET name = :name, icon = :icon, color = :color, " +
      "updated_at = MAX(updated_at + 1, :updatedAt), sync_seq = :syncSeq WHERE id = :profileId",
  )
  suspend fun updateProfileMetadataRow(
    profileId: String,
    name: String,
    icon: String,
    color: String,
    updatedAt: Long,
    syncSeq: Long,
  ): Int

  @Transaction
  suspend fun updateProfileMetadata(
    profileId: String,
    name: String,
    icon: String,
    color: String,
    updatedAt: Long,
  ): Int = updateProfileMetadataRow(
    profileId,
    name,
    icon,
    color,
    updatedAt,
    nextSyncSeq(SYNC_SEQ_TUNE_PROFILES),
  )

  @Query("SELECT * FROM tune_history_entries WHERE id = :id LIMIT 1")
  suspend fun getTuneHistoryEntry(id: Long): TuneHistoryEntryEntity?

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun insertTuneProfileRow(profile: TuneProfileEntity)

  @Query("SELECT updated_at FROM tune_profiles WHERE id = :id")
  suspend fun getTuneProfileUpdatedAt(id: String): Long?

  /** Stamps both sync columns; see [upsertBoard]. */
  @Transaction
  suspend fun upsertTuneProfile(profile: TuneProfileEntity) {
    insertTuneProfileRow(
      profile.copy(
        updatedAt = ratchetUpdatedAt(getTuneProfileUpdatedAt(profile.id), profile.updatedAt),
        syncSeq = nextSyncSeq(SYNC_SEQ_TUNE_PROFILES),
      ),
    )
  }

  @Insert(onConflict = OnConflictStrategy.IGNORE)
  suspend fun insertTuneProfileRowIfAbsent(profile: TuneProfileEntity): Long

  /** Stamps both sync columns; see [upsertBoard]. Returns -1 when the row already exists. */
  @Transaction
  suspend fun insertTuneProfile(profile: TuneProfileEntity): Long =
    insertTuneProfileRowIfAbsent(
      profile.copy(
        updatedAt = ratchetUpdatedAt(getTuneProfileUpdatedAt(profile.id), profile.updatedAt),
        syncSeq = nextSyncSeq(SYNC_SEQ_TUNE_PROFILES),
      ),
    )

  @Query("SELECT COUNT(*) FROM tune_profiles WHERE board_id = :boardId AND refloat_base_version = :refloatBaseVersion")
  suspend fun countTuneProfilesForBoard(boardId: String, refloatBaseVersion: String): Int

  @Insert
  suspend fun insertTuneHistoryEntry(entry: TuneHistoryEntryEntity): Long

  // `id` breaks ties: a save and a rollback can land in the same millisecond, and without a
  // monotonic tiebreaker `created_at DESC` alone returns them in insertion order — oldest first —
  // which is the opposite of what Tune History shows.
  @Query("SELECT * FROM tune_history_entries WHERE profile_id = :profileId ORDER BY created_at DESC, id DESC")
  suspend fun getTuneHistoryEntries(profileId: String): List<TuneHistoryEntryEntity>

  /** Targeted save that bypasses the upsert, so it moves both columns itself; see
   * [setAlertRuleEnabledRow]. */
  @Query(
    "UPDATE tune_profiles SET fields_json = :fieldsJson, " +
      "updated_at = MAX(updated_at + 1, :updatedAt), sync_seq = :syncSeq WHERE id = :profileId",
  )
  suspend fun updateProfileFieldsRow(
    profileId: String,
    fieldsJson: String,
    updatedAt: Long,
    syncSeq: Long,
  ): Int

  @Transaction
  suspend fun updateProfileFields(profileId: String, fieldsJson: String, updatedAt: Long): Int =
    updateProfileFieldsRow(profileId, fieldsJson, updatedAt, nextSyncSeq(SYNC_SEQ_TUNE_PROFILES))

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
    deleteTuneHistoryForProfileRaw(profileId)
    appendDeleteAction(DeleteTarget.TUNE_PROFILE, null, profileId, profile.updatedAt)
    deleteTuneProfileRow(profileId)
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
  suspend fun insertBoardWarningRow(warning: BoardWarningEntity)

  @Query("SELECT updated_at FROM board_warnings WHERE board_id = :boardId AND kind = :kind")
  suspend fun getBoardWarningUpdatedAt(boardId: String, kind: String): Long?

  /**
   * Stamps both sync columns; see [upsertBoard]. The caller supplies detection times only —
   * `updated_at` is authored here, from [BoardWarningEntity.lastDetectedAt] as the write clock.
   */
  @Transaction
  suspend fun upsertBoardWarning(warning: BoardWarningEntity) {
    insertBoardWarningRow(
      warning.copy(
        updatedAt = ratchetUpdatedAt(
          getBoardWarningUpdatedAt(warning.boardId, warning.kind),
          warning.lastDetectedAt,
        ),
        syncSeq = nextSyncSeq(SYNC_SEQ_BOARD_WARNINGS),
      ),
    )
  }

  @Query("SELECT last_detected_at FROM board_warnings WHERE board_id = :boardId AND kind = :kind")
  suspend fun getBoardWarningLastDetectedAt(boardId: String, kind: String): Long?

  @Query("SELECT kind FROM board_warnings WHERE board_id = :boardId")
  suspend fun getBoardWarningKinds(boardId: String): List<String>

  @Query("DELETE FROM board_warnings WHERE board_id = :boardId AND kind = :kind")
  suspend fun deleteBoardWarningRow(boardId: String, kind: String): Int

  /**
   * Semantic removal, whether the Rider cleared the warning or a detector evaluated the kind with
   * real data and found the condition gone — an automatic clear is still a durable state transition
   * the server has to make (#282).
   *
   * Stamped from `last_detected_at` rather than `updated_at`: it is the warning's own change clock,
   * and it is what the row's `updated_at` was written from.
   */
  @Transaction
  suspend fun deleteBoardWarning(boardId: String, kind: String): Int {
    appendDeleteAction(
      DeleteTarget.BOARD_WARNING,
      boardId,
      kind,
      getBoardWarningLastDetectedAt(boardId, kind),
    )
    return deleteBoardWarningRow(boardId, kind)
  }

  @Query("DELETE FROM board_warnings WHERE board_id = :boardId")
  suspend fun deleteBoardWarningsRaw(boardId: String): Int

  /**
   * The Rider cleared every warning on one Board: one action per removed row, because each row is a
   * separate piece of current state. Distinct from the Board delete's cascade, which is raw.
   */
  @Transaction
  suspend fun deleteBoardWarnings(boardId: String): Int {
    var removed = 0
    for (kind in getBoardWarningKinds(boardId)) removed += deleteBoardWarning(boardId, kind)
    return removed
  }

  // Favorites — durable pins over Ride History (ADR 0029). Deleting a row only unpins; telemetry
  // inside the range is never touched here.
  // @parity /modules/vescape-core/ios/telemetry/FavoriteStore.swift

  @Query("SELECT * FROM favorites ORDER BY start_ms DESC")
  suspend fun getFavorites(): List<FavoriteEntity>

  @Insert
  suspend fun insertFavoriteRow(favorite: FavoriteEntity)

  @Query("SELECT * FROM favorites WHERE id = :id")
  suspend fun getFavorite(id: String): FavoriteEntity?

  @Query("SELECT updated_at FROM favorites WHERE id = :id")
  suspend fun getFavoriteUpdatedAt(id: String): Long?

  @Update
  suspend fun updateFavoriteRow(favorite: FavoriteEntity): Int

  /** Stamps both sync columns; see [upsertBoard]. */
  @Transaction
  suspend fun insertFavorite(favorite: FavoriteEntity) {
    insertFavoriteRow(favorite.copy(syncSeq = nextSyncSeq(SYNC_SEQ_FAVORITES)))
  }

  /**
   * Re-trim/rename one row in place so its identity and Favorite Media remain stable. Stamps both
   * sync columns; see [upsertBoard].
   */
  @Transaction
  suspend fun updateFavorite(favorite: FavoriteEntity): Int = updateFavoriteRow(
    favorite.copy(
      updatedAt = ratchetUpdatedAt(getFavoriteUpdatedAt(favorite.id), favorite.updatedAt),
      syncSeq = nextSyncSeq(SYNC_SEQ_FAVORITES),
    ),
  )

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

  /** Parent-covered cascade: raw, because the Favorite's own action covers its manifest rows. */
  @Query("DELETE FROM favorite_media WHERE favorite_id = :favoriteId")
  suspend fun deleteFavoriteMediaForFavoriteRaw(favoriteId: String): Int

  @Query("DELETE FROM favorite_media WHERE favorite_id NOT IN (SELECT id FROM favorites)")
  suspend fun deleteOrphanFavoriteMedia(): Int

  /**
   * Semantic removal of the Favorite, with its Favorite Media manifest rows as a parent-covered raw
   * cascade — one action, not one per media row, matching the server's own cascade.
   */
  @Transaction
  suspend fun deleteFavorite(id: String): Int {
    deleteFavoriteMediaForFavoriteRaw(id)
    appendDeleteAction(DeleteTarget.FAVORITE, null, id, getFavoriteUpdatedAt(id))
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
    faultCount = faultCount + next.faultCount,
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
    // The merged row is being written now, so `next` normally carries the fresher stamp. The same
    // ratchet as boards and alerts, for the same reason: the server guards this table with
    // `WHERE stored.updated_at < EXCLUDED.updated_at` like every other mutable table, so a stamp
    // frozen at the stored value would satisfy the scan and still be dropped server-side.
    updatedAt = ratchetUpdatedAt(updatedAt, next.updatedAt),
    syncSeq = next.syncSeq,
  )
}

/**
 * The write-time fold behind [BoardEntity.updatedAt]: never below the value already stored, and
 * strictly above it whenever the clock fails to be.
 *
 * `+ 1` rather than a plain `maxOf` because the server keeps the stored row unless the incoming
 * stamp is strictly newer. Freezing at the old value would satisfy the scan and still lose the edit.
 */
internal fun ratchetUpdatedAt(previous: Long?, now: Long): Long =
  if (previous == null) now else maxOf(previous + 1, now)

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
