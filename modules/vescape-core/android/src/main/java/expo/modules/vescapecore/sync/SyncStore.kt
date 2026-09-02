package expo.modules.vescapecore.sync

import expo.modules.vescapecore.telemetry.TelemetryDao

/**
 * The database side of the uploader: the forward scan, the cursor commit and the failure record.
 *
 * Encoding happens here rather than in the engine, so the pure batch builder measures the exact
 * bytes that will be sent. Rows are read in [SyncTable] order and the scan stops once the row limit
 * is reached — a table further down waits for the next batch, which is what keeps parents ahead of
 * children.
 *
 * @parity /modules/vescape-core/ios/sync/SyncStore.swift `SyncStore`
 */
class SyncStore(
  /** Resolved per call: an Account reset replaces the whole database under this object. */
  private val database: () -> TelemetryDao,
  private val generation: () -> Long,
  private val onPermanentFailure: (SyncPauseReason, String) -> Unit,
) : SyncSource {

  override suspend fun pending(rowLimit: Int): List<SyncPendingTable> {
    val tables = ArrayList<SyncPendingTable>(SyncTable.entries.size)
    var budget = rowLimit
    for (table in SyncTable.entries) {
      if (budget <= 0) break
      val rows = read(table, database().cursorOf(table.cursorKey), budget)
      if (rows.isEmpty()) continue
      tables += SyncPendingTable(table, rows)
      budget -= rows.size
    }
    return tables
  }

  override suspend fun pendingCount(): Int {
    var total = 0
    for (table in SyncTable.entries) {
      val cursor = database().cursorOf(table.cursorKey)
      total += when (table) {
        SyncTable.APP_SETTINGS -> database().countAppSettingsAfter(cursor)
        SyncTable.BOARDS -> database().countBoardsAfter(cursor)
        SyncTable.BOARD_SETTINGS -> database().countBoardSettingsAfter(cursor)
        SyncTable.BOARD_WARNINGS -> database().countBoardWarningsAfter(cursor)
        SyncTable.ALERTS -> database().countAlertsAfter(cursor)
        SyncTable.TUNE_PROFILES -> database().countTuneProfilesAfter(cursor)
        SyncTable.TUNE_HISTORY_ENTRIES -> database().countTuneHistoryEntriesAfter(cursor)
        SyncTable.PRIVACY_ZONES -> database().countPrivacyZonesAfter(cursor)
        SyncTable.TELEMETRY_MARKERS -> database().countTelemetryMarkersAfter(cursor)
        SyncTable.METRIC_EXCLUSION_RANGES -> database().countExclusionRangesAfter(cursor)
        SyncTable.DIAGNOSTIC_EVENTS -> database().countDiagnosticEventsAfter(cursor)
        SyncTable.TELEMETRY_FRAMES -> database().countTelemetryFramesAfter(cursor)
        SyncTable.TELEMETRY_MINUTE_BUCKETS -> database().countMinuteBucketsAfter(cursor)
        SyncTable.FAVORITES -> database().countFavoritesAfter(cursor)
        SyncTable.VESC_FAULT_OCCURRENCES -> database().countVescFaultOccurrencesAfter(cursor)
        SyncTable.VESC_FAULT_CAPTURES -> database().countVescFaultCapturesAfter(cursor)
        SyncTable.VESC_FAULT_CAPTURE_SAMPLES -> database().countVescFaultCaptureSamplesAfter(cursor)
        SyncTable.DELETE_ACTIONS -> database().countSyncActionsAfter(cursor)
      }
    }
    return total
  }

  /**
   * Cursors move only here, only after the server accepted, and each in its own statement. The
   * accepted Sync Action cursor is also what prunes the log, so pruning can never outrun it.
   */
  override suspend fun commit(advances: Map<SyncTable, Long>) {
    for ((table, cursor) in advances) database().commitSyncCursor(table.cursorKey, cursor)
    if (advances.containsKey(SyncTable.DELETE_ACTIONS)) database().pruneUploadedSyncActions()
  }

  override fun generation(): Long = generation.invoke()

  override suspend fun recordPermanentFailure(reason: SyncPauseReason, detail: String) {
    onPermanentFailure(reason, detail)
  }

  private suspend fun read(table: SyncTable, cursor: Long, limit: Int): List<SyncPendingRow> =
    when (table) {
      SyncTable.APP_SETTINGS ->
        database().getAppSettingsAfter(cursor, limit).map { SyncPendingRow(it.syncSeq, SyncWire.appSetting(it)) }
      SyncTable.BOARDS ->
        database().getBoardsAfter(cursor, limit).map { SyncPendingRow(it.syncSeq, SyncWire.board(it)) }
      SyncTable.BOARD_SETTINGS ->
        database().getBoardSettingsAfter(cursor, limit).map { SyncPendingRow(it.syncSeq, SyncWire.boardSetting(it)) }
      SyncTable.BOARD_WARNINGS ->
        database().getBoardWarningsAfter(cursor, limit).map { SyncPendingRow(it.syncSeq, SyncWire.boardWarning(it)) }
      SyncTable.ALERTS ->
        database().getAlertsAfter(cursor, limit).map { SyncPendingRow(it.syncSeq, SyncWire.alert(it)) }
      SyncTable.TUNE_PROFILES ->
        database().getTuneProfilesAfter(cursor, limit).map { SyncPendingRow(it.syncSeq, SyncWire.tuneProfile(it)) }
      SyncTable.TUNE_HISTORY_ENTRIES ->
        database().getTuneHistoryEntriesAfter(cursor, limit).map { SyncPendingRow(it.id, SyncWire.tuneHistoryEntry(it)) }
      SyncTable.PRIVACY_ZONES ->
        database().getPrivacyZonesAfter(cursor, limit).map { SyncPendingRow(it.syncSeq, SyncWire.privacyZone(it)) }
      SyncTable.TELEMETRY_MARKERS ->
        database().getTelemetryMarkersAfter(cursor, limit).map { SyncPendingRow(it.id, SyncWire.telemetryMarker(it)) }
      SyncTable.METRIC_EXCLUSION_RANGES ->
        database().getExclusionRangesAfter(cursor, limit).map { SyncPendingRow(it.id, SyncWire.metricExclusionRange(it)) }
      SyncTable.DIAGNOSTIC_EVENTS ->
        database().getDiagnosticEventsAfter(cursor, limit).map { SyncPendingRow(it.id, SyncWire.diagnosticEvent(it)) }
      SyncTable.TELEMETRY_FRAMES ->
        database().getTelemetryFramesAfter(cursor, limit).map { SyncPendingRow(it.id, SyncWire.telemetryFrame(it)) }
      SyncTable.TELEMETRY_MINUTE_BUCKETS ->
        database().getMinuteBucketsAfter(cursor, limit).map { SyncPendingRow(it.syncSeq, SyncWire.telemetryMinuteBucket(it)) }
      SyncTable.FAVORITES ->
        database().getFavoritesAfter(cursor, limit).map { SyncPendingRow(it.syncSeq, SyncWire.favorite(it)) }
      SyncTable.VESC_FAULT_OCCURRENCES ->
        database().getVescFaultOccurrencesAfter(cursor, limit).map { SyncPendingRow(it.syncSeq, SyncWire.vescFaultOccurrence(it)) }
      SyncTable.VESC_FAULT_CAPTURES ->
        database().getVescFaultCapturesAfter(cursor, limit).map { SyncPendingRow(it.syncSeq, SyncWire.vescFaultCapture(it)) }
      SyncTable.VESC_FAULT_CAPTURE_SAMPLES ->
        database().getVescFaultCaptureSamplesAfter(cursor, limit).map { SyncPendingRow(it.id, SyncWire.vescFaultCaptureSample(it)) }
      SyncTable.DELETE_ACTIONS ->
        database().getSyncActionsAfter(cursor, limit).map { SyncPendingRow(it.id, SyncWire.deleteAction(it)) }
    }
}
