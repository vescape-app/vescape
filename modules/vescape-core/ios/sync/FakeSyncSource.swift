import Foundation
@testable import VescapeCore

/// A `SyncSource` that models the database the way `SyncStore` actually behaves: rows keyed by their
/// cursor position, a scan that serves strictly `cursor > committed` in ascending order, and a
/// commit that ratchets each table's cursor forward and never backwards.
///
/// The point of modelling it rather than counting is that the loss bug is a cursor bug. A source
/// that decrements a row counter accepts an advance set naming the wrong position — the exact
/// mistake that makes a row unreachable forever — because the next scan is not derived from what was
/// committed. Here it is, so a wrong advance shows up as a row nobody is ever offered again.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/sync/FakeSyncSource.kt
final class FakeSyncSource: SyncSource {

  /// Cursor positions present per table, ascending — the rows on disk.
  private let rows: [SyncTable: [Int64]]

  /// How far each table has been accepted. Absent means nothing delivered.
  var cursors: [SyncTable: Int64] = [:]

  /// Every advance set handed to `commit`, in order.
  var committed: [[SyncTable: Int64]] = []

  var currentGeneration: Int64 = 0
  var failures: [(SyncPauseReason, String)] = []
  var encodeFailure: SyncProtocolError?
  var commitFailure: Error?

  /// Caps one scan below the engine's own row limit, so a drain takes more than one pass.
  var scanLimit = Int.max

  init(_ seed: [SyncTable: [Int64]]) {
    rows = seed.mapValues { $0.sorted() }
  }

  convenience init(rows count: Int) {
    self.init([.boards: count > 0 ? (1...Int64(count)).map { $0 } : []])
  }

  /// Rows the scan will still offer. Zero means the backlog is drained.
  var remaining: Int {
    rows.reduce(0) { total, entry in
      total + entry.value.filter { $0 > cursor(entry.key) }.count
    }
  }

  private func cursor(_ table: SyncTable) -> Int64 { cursors[table] ?? 0 }

  /// Each row carries its own cursor on the wire, so a fake server can report back exactly which
  /// rows it stored. Without row identity in the body, "the server received everything" is not a
  /// claim a test can make.
  private func rowJson(_ cursor: Int64) -> String { "{\"c\":\(cursor)}" }

  /// Mirrors `SyncStore.pending`: table order, one shared row budget, forward from each cursor.
  func pending(rowLimit: Int) throws -> [SyncPendingTable] {
    if let encodeFailure { throw encodeFailure }
    var tables: [SyncPendingTable] = []
    var budget = min(rowLimit, scanLimit)
    for table in SyncTable.allCases {
      if budget <= 0 { break }
      guard let positions = rows[table] else { continue }
      let pending = positions.filter { $0 > cursor(table) }.prefix(budget)
      if pending.isEmpty { continue }
      tables.append(
        SyncPendingTable(table: table, rows: pending.map { SyncPendingRow(cursor: $0, json: rowJson($0)) })
      )
      budget -= pending.count
    }
    return tables
  }

  func pendingCount() -> Int { remaining }

  /// Mirrors `commitSyncCursor`: `MAX(existing, incoming)`, so a cursor never moves backwards.
  func commit(_ advances: [SyncTable: Int64]) throws {
    if let commitFailure { throw commitFailure }
    committed.append(advances)
    for (table, position) in advances { cursors[table] = max(cursor(table), position) }
  }

  func generation() -> Int64 { currentGeneration }

  func recordPermanentFailure(_ reason: SyncPauseReason, detail: String) {
    failures.append((reason, detail))
  }

  /// Every row on disk, for the loss invariant.
  func allRows() -> Set<SyncRowRef> {
    Set(rows.flatMap { table, positions in positions.map { SyncRowRef(table: table, cursor: $0) } })
  }
}

/// One row's identity, so a test can compare what is on disk against what the server holds.
struct SyncRowRef: Hashable {
  let table: SyncTable
  let cursor: Int64
}
