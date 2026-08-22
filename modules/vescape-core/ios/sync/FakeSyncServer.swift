import Foundation
@testable import VescapeCore

/// A server that stores what it is sent and answers with the accepted map the real one would.
///
/// It exists so a test can assert the only thing that matters end to end: every row the Rider owns
/// reached the server. The engine's own return values cannot show that — a cursor advanced past a
/// row that was never in a batch reports `sent` and looks identical to a correct pass.
///
/// Stores rows by identity and upserts, exactly like the real one, so a re-send after a lost
/// checkpoint is a no-op rather than a duplicate.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/sync/FakeSyncServer.kt
final class FakeSyncServer {

  /// Every row the server holds, by table and cursor.
  var stored: Set<SyncRowRef> = []

  /// Bodies received, including the ones answered with a failure.
  var received: [String] = []

  /// Rows written, counting re-sends — the cost of failing toward re-sending.
  private(set) var writes = 0

  /// Queued failures, consumed one per request before the server stores anything.
  var failures: [SyncResponse] = []

  /// Fires after the batch is stored but before the response is returned.
  var afterStore: (() -> Void)?

  /// Store the next batch and then answer as if the response never arrived. The engine cannot tell
  /// this apart from a batch that was never applied, which is exactly why it re-sends.
  var loseNextResponse = false

  private let byWire = Dictionary(uniqueKeysWithValues: SyncTable.allCases.map { ($0.wire, $0) })

  func send(_ body: String) -> SyncResponse {
    received.append(body)
    if !failures.isEmpty { return failures.removeFirst() }

    let batch = (try? JSONSerialization.jsonObject(with: Data(body.utf8))) as? [String: Any] ?? [:]
    var counts: [SyncTable: Int] = [:]
    for (wire, value) in batch {
      guard let table = byWire[wire], let rows = value as? [[String: Any]] else { continue }
      counts[table] = rows.count
      writes += rows.count
      // Rows from the real store carry their own columns, not a test cursor. Identity tracking is
      // best-effort so the same server works for both; `writes` counts every row either way.
      for row in rows {
        guard let cursor = (row["c"] as? NSNumber)?.int64Value else { continue }
        stored.insert(SyncRowRef(table: table, cursor: cursor))
      }
    }
    afterStore?()
    if loseNextResponse {
      loseNextResponse = false
      return .transient(reason: "timeout")
    }
    return .accepted(body: accepted(counts))
  }

  /// The server answers for every table it knows, not only the ones the batch carried.
  private func accepted(_ counts: [SyncTable: Int]) -> String {
    let body = SyncTable.allCases.map { "\"\($0.wire)\":\(counts[$0] ?? 0)" }.joined(separator: ",")
    return "{\"accepted\":{\(body)}}"
  }
}
