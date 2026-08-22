import Foundation

/// Every table a Sync Batch can carry, in the order the server writes them: a Board-owned row
/// references its Board, so a batch carrying both has to put the Board first or the foreign key
/// refuses the whole batch. Delete Actions come last, so an action is judged against the Change
/// Timestamp the same batch just wrote.
///
/// The batch builder walks this order and nothing else — never the size of a table's backlog, which
/// would produce a batch the server cannot apply.
///
/// `cursorColumn` is what the scan runs on: an `AUTOINCREMENT` key for append-only tables,
/// `sync_seq` for mutable ones. Both are device-local counters that never cross the wire.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sync/SyncTables.kt `SyncTable`
/// @parity /modules/vescape-core/src/index.ts `SyncTable`
enum SyncTable: String, CaseIterable {
  case appSettings
  case boards
  case boardSettings
  case boardWarnings
  case alerts
  case tuneProfiles
  case tuneHistoryEntries
  case privacyZones
  case telemetryMarkers
  case metricExclusionRanges
  case diagnosticEvents
  case telemetryFrames
  case telemetryMinuteBuckets
  case favorites
  case deleteActions

  var wire: String { rawValue }

  var table: String {
    switch self {
    case .appSettings: return "app_settings"
    case .boards: return "boards"
    case .boardSettings: return "board_settings"
    case .boardWarnings: return "board_warnings"
    case .alerts: return "alerts"
    case .tuneProfiles: return "tune_profiles"
    case .tuneHistoryEntries: return "tune_history_entries"
    case .privacyZones: return "privacy_zones"
    case .telemetryMarkers: return "telemetry_markers"
    case .metricExclusionRanges: return "metric_exclusion_ranges"
    case .diagnosticEvents: return "diagnostic_events"
    case .telemetryFrames: return "telemetry_frames"
    case .telemetryMinuteBuckets: return "telemetry_minute_buckets"
    case .favorites: return "favorites"
    case .deleteActions: return "sync_actions"
    }
  }

  var cursorColumn: String {
    switch self {
    case .tuneHistoryEntries, .telemetryMarkers, .metricExclusionRanges, .diagnosticEvents,
         .telemetryFrames, .deleteActions:
      return syncRowIdColumn
    default:
      return syncSeqColumn
    }
  }

  /// `sync_sequences` key holding how far this table has been accepted. Distinct from the write
  /// counters keyed on the bare table name, which hand out `sync_seq` positions.
  ///
  /// Sync Actions keep the key #282 already shipped, so the log's prune keeps reading the same row
  /// the uploader commits.
  var cursorKey: String {
    self == .deleteActions ? syncActionsUploadedCursor : syncCursorPrefix + table
  }
}

internal let syncSeqColumn = "sync_seq"
internal let syncRowIdColumn = "id"
internal let syncCursorPrefix = "sync_cursor_"

/// Rows accepted in one Sync Batch, total across every table.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sync/SyncTables.kt `MAX_SYNC_BATCH_ROWS`
let maxSyncBatchRows = 1_000

/// Actual compact UTF-8 JSON bytes accepted by `POST /api/sync`. Measured on the encoded request,
/// not estimated from object sizes — the server refuses on the byte count it actually receives.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sync/SyncTables.kt `MAX_SYNC_BATCH_BYTES`
let maxSyncBatchBytes = 1024 * 1024

/// Longest text one column of a server key may hold. Mirrored from the server so a row that cannot
/// be stored is refused here instead of wedging a batch.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sync/SyncTables.kt `MAX_SYNC_KEY_LENGTH`
let maxSyncKeyLength = 128

/// Bounds of the Postgres `integer` columns the app's 32-bit values land in.
internal let syncInt32Min: Int64 = -2_147_483_648
internal let syncInt32Max: Int64 = 2_147_483_647

/// `Number.MAX_SAFE_INTEGER`: past it `JSON.parse` rounds, so neither side could agree on the value.
internal let syncSafeIntMax: Int64 = 9_007_199_254_740_991

/// The five retained tables' cursor keys, named so cursor-gated retention reads what the uploader
/// commits.
internal let syncCursorFrames = "sync_cursor_telemetry_frames"
internal let syncCursorMarkers = "sync_cursor_telemetry_markers"
internal let syncCursorMinuteBuckets = "sync_cursor_telemetry_minute_buckets"
internal let syncCursorDiagnosticEvents = "sync_cursor_diagnostic_events"
internal let syncCursorExclusionRanges = "sync_cursor_metric_exclusion_ranges"
