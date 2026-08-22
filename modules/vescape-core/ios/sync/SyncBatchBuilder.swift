import Foundation

/// One row waiting to be uploaded: its cursor position and the compact JSON the server will read.
///
/// The JSON is encoded once, by the wire layer, so the builder measures the bytes that will actually
/// be sent rather than estimating from an object graph.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sync/SyncBatchBuilder.kt `SyncPendingRow`
struct SyncPendingRow: Equatable {
  let cursor: Int64
  let json: String
  let byteCount: Int

  init(cursor: Int64, json: String) {
    self.cursor = cursor
    self.json = json
    self.byteCount = json.utf8.count
  }
}

/// One table's pending rows, in cursor order.
struct SyncPendingTable: Equatable {
  let table: SyncTable
  let rows: [SyncPendingRow]
}

/// What the builder made of the pending rows.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sync/SyncBatchBuilder.kt `SyncBatchBuild`
enum SyncBatchBuild: Equatable {
  /// Nothing pending.
  case empty

  /// A batch and the cursor advance set describing exactly the rows in it. Cursors are committed
  /// only after the server accepts, and only these positions move.
  case ready(SyncBuiltBatch)

  /// One row cannot fit a batch of its own. Never skipped and never quarantined: the engine pauses
  /// with the row retained, because dropping it would silently lose data a Rider believes is backed
  /// up.
  case rowTooLarge(table: SyncTable, cursor: Int64, byteCount: Int)
}

struct SyncBuiltBatch: Equatable {
  let body: String
  /// Table order preserved, so a test can assert parents precede children.
  let tables: [SyncTable]
  let counts: [SyncTable: Int]
  let advances: [SyncTable: Int64]
  let rowCount: Int
  let byteCount: Int
}

/// Fills a Sync Batch from per-table pending rows.
///
/// Pure: no database, no clock, no network. It walks `SyncTable` declaration order — the order the
/// server applies a batch in — and stops at whichever cap comes first. Ordering by backlog size
/// would produce a batch whose children arrive before their parents, which the server refuses whole.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sync/SyncBatchBuilder.kt `SyncBatchBuilder`
enum SyncBatchBuilder {
  static func build(
    _ pending: [SyncPendingTable],
    rowCap: Int = maxSyncBatchRows,
    byteCap: Int = maxSyncBatchBytes
  ) -> SyncBatchBuild {
    let order = SyncTable.allCases
    let ordered = pending
      .filter { !$0.rows.isEmpty }
      .sorted { left, right in
        (order.firstIndex(of: left.table) ?? 0) < (order.firstIndex(of: right.table) ?? 0)
      }
    if ordered.isEmpty { return .empty }

    var body = "{"
    var tables: [SyncTable] = []
    var counts: [SyncTable: Int] = [:]
    var advances: [SyncTable: Int64] = [:]
    var rowCount = 0
    // `{}`; every other cost below is added as the exact bytes appended.
    var byteCount = 2

    for group in ordered {
      if rowCount >= rowCap { break }
      // `,"appSettings":[]` — the separating comma only once a table is already open.
      let header = (tables.isEmpty ? "" : ",") + "\"" + group.table.wire + "\":["
      let tableOverhead = header.utf8.count + 1
      if byteCount + tableOverhead > byteCap { break }

      var opened = false
      var truncated = false
      for row in group.rows {
        if rowCount >= rowCap { break }
        let rowCost = row.byteCount + (opened ? 1 : 0)
        let overhead = opened ? 0 : tableOverhead
        if byteCount + overhead + rowCost > byteCap {
          // A row no empty batch could carry is a permanent local protocol error, not a cap hit.
          if tables.isEmpty, !opened, 2 + tableOverhead + row.byteCount > byteCap {
            return .rowTooLarge(table: group.table, cursor: row.cursor, byteCount: row.byteCount)
          }
          truncated = true
          break
        }

        if !opened {
          body += header
          byteCount += tableOverhead
          tables.append(group.table)
          counts[group.table] = 0
          opened = true
        } else {
          body += ","
        }
        body += row.json
        byteCount += rowCost
        rowCount += 1
        counts[group.table] = (counts[group.table] ?? 0) + 1
        advances[group.table] = row.cursor
      }
      if opened { body += "]" }
      // A table cut short by the byte cap may still hold a parent — a Board whose settings, alerts
      // or Tune Profiles sit further down this same batch. Carrying on would send the child ahead of
      // it, and the server refuses that whole batch on the foreign key. The rest waits for the next
      // batch, which starts where this one stopped.
      if truncated { break }
    }

    if tables.isEmpty { return .empty }
    body += "}"
    return .ready(
      SyncBuiltBatch(
        body: body,
        tables: tables,
        counts: counts,
        advances: advances,
        rowCount: rowCount,
        byteCount: byteCount
      )
    )
  }
}
