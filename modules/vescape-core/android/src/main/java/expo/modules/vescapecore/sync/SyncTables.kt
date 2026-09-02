package expo.modules.vescapecore.sync

/**
 * Every table a Sync Batch can carry, in the order the server writes them: a Board-owned row
 * references its Board, so a batch carrying both has to put the Board first or the foreign key
 * refuses the whole batch. Delete Actions come last, so an action is judged against the Change
 * Timestamp the same batch just wrote.
 *
 * The batch builder walks this order and nothing else — never the size of a table's backlog, which
 * would produce a batch the server cannot apply.
 *
 * [cursorColumn] is what the scan runs on: an `AUTOINCREMENT` key for append-only tables, `sync_seq`
 * for mutable ones. Both are device-local counters that never cross the wire.
 *
 * @parity /modules/vescape-core/ios/sync/SyncTables.swift `SyncTable`
 */
enum class SyncTable(val wire: String, val table: String, val cursorColumn: String) {
  APP_SETTINGS("appSettings", "app_settings", SYNC_SEQ_COLUMN),
  BOARDS("boards", "boards", SYNC_SEQ_COLUMN),
  BOARD_SETTINGS("boardSettings", "board_settings", SYNC_SEQ_COLUMN),
  BOARD_WARNINGS("boardWarnings", "board_warnings", SYNC_SEQ_COLUMN),
  ALERTS("alerts", "alerts", SYNC_SEQ_COLUMN),
  TUNE_PROFILES("tuneProfiles", "tune_profiles", SYNC_SEQ_COLUMN),
  TUNE_HISTORY_ENTRIES("tuneHistoryEntries", "tune_history_entries", ROW_ID_COLUMN),
  PRIVACY_ZONES("privacyZones", "privacy_zones", SYNC_SEQ_COLUMN),
  TELEMETRY_MARKERS("telemetryMarkers", "telemetry_markers", ROW_ID_COLUMN),
  METRIC_EXCLUSION_RANGES("metricExclusionRanges", "metric_exclusion_ranges", ROW_ID_COLUMN),
  DIAGNOSTIC_EVENTS("diagnosticEvents", "diagnostic_events", ROW_ID_COLUMN),
  TELEMETRY_FRAMES("telemetryFrames", "telemetry_frames", ROW_ID_COLUMN),
  TELEMETRY_MINUTE_BUCKETS("telemetryMinuteBuckets", "telemetry_minute_buckets", SYNC_SEQ_COLUMN),
  FAVORITES("favorites", "favorites", SYNC_SEQ_COLUMN),

  // Board-owned, so after `boards`; the Capture and its samples reference the Occurrence, so after
  // it in turn. This chain is the one place the ordering rule bites twice inside one batch.
  VESC_FAULT_OCCURRENCES("vescFaultOccurrences", "vesc_fault_occurrences", SYNC_SEQ_COLUMN),
  VESC_FAULT_CAPTURES("vescFaultCaptures", "vesc_fault_captures", SYNC_SEQ_COLUMN),
  VESC_FAULT_CAPTURE_SAMPLES("vescFaultCaptureSamples", "vesc_fault_capture_samples", ROW_ID_COLUMN),
  DELETE_ACTIONS("deleteActions", "sync_actions", ROW_ID_COLUMN),
  ;

  /**
   * `sync_sequences` key holding how far this table has been accepted. Distinct from the write
   * counters keyed on the bare table name, which hand out `sync_seq` positions.
   *
   * Sync Actions keep the key #282 already shipped, so the log's prune keeps reading the same row
   * the uploader commits.
   */
  val cursorKey: String
    get() = if (this == DELETE_ACTIONS) {
      expo.modules.vescapecore.telemetry.SYNC_ACTIONS_UPLOADED_CURSOR
    } else {
      "$SYNC_CURSOR_PREFIX$table"
    }
}

internal const val SYNC_SEQ_COLUMN = "sync_seq"
internal const val ROW_ID_COLUMN = "id"
internal const val SYNC_CURSOR_PREFIX = "sync_cursor_"

/**
 * Rows accepted in one Sync Batch, total across every table.
 * @parity /modules/vescape-core/ios/sync/SyncTables.swift `maxSyncBatchRows`
 */
const val MAX_SYNC_BATCH_ROWS = 1_000

/**
 * Actual compact UTF-8 JSON bytes accepted by `POST /api/sync`. Measured on the encoded request, not
 * estimated from object sizes — the server refuses on the byte count it actually receives.
 * @parity /modules/vescape-core/ios/sync/SyncTables.swift `maxSyncBatchBytes`
 */
const val MAX_SYNC_BATCH_BYTES = 1024 * 1024

/**
 * Longest text one column of a server key may hold. Mirrored from the server so a row that cannot be
 * stored is refused here instead of wedging a batch.
 * @parity /modules/vescape-core/ios/sync/SyncTables.swift `maxSyncKeyLength`
 */
const val MAX_SYNC_KEY_LENGTH = 128

/** Bounds of the Postgres `integer` columns the app's 32-bit values land in. */
internal const val SYNC_INT32_MIN = -2_147_483_648L
internal const val SYNC_INT32_MAX = 2_147_483_647L

/** `Number.MAX_SAFE_INTEGER`: past it `JSON.parse` rounds, so neither side could agree on the value. */
internal const val SYNC_SAFE_INT_MAX = 9_007_199_254_740_991L
