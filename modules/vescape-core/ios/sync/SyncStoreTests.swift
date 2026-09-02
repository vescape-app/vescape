import GRDB
import XCTest
@testable import VescapeCore

/// `SyncStore` against a real database: the forward scan, the cursor commit, and a whole backlog
/// drained through the real engine.
///
/// Everything else in the sync suite runs on a fake source. That makes the engine's decisions
/// testable but leaves the store itself — the SQL that decides which rows go next, and the write
/// that says which are safe to forget — never executed. This is where the two meet, so a scan that
/// re-reads a delivered row, or a commit that skips one, fails here rather than on a Rider's phone.
///
/// The Android peer asserts the same scan predicates against the DAO source, because Room keeps its
/// SQL out of reach of a JVM unit test.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/sync/SyncCursorContractTest.kt
final class SyncStoreTests: XCTestCase {
  private var queue: DatabaseQueue!
  private var generation: Int64 = 0
  private var now: Int64 = 1_000

  override func setUpWithError() throws {
    queue = try DatabaseQueue()
    try TelemetryDatabase.migrator.migrate(queue)
    generation = 0
    now = 1_000
  }

  override func tearDownWithError() throws {
    queue = nil
  }

  private func store() -> SyncStore {
    SyncStore(
      generation: { self.generation },
      onPermanentFailure: { _, _ in },
      database: { self.queue }
    )
  }

  // Seeding. `sync_seq` is passed explicitly: these tests are about the scan reading it, not about
  // the write path that hands positions out.

  private func seedBoard(_ id: String, syncSeq: Int64) throws {
    try queue.write { db in
      try db.execute(
        sql: """
          INSERT INTO boards (id, name, ble_id, transport, created_at, updated_at, sync_seq, deleted_at)
          VALUES (?, ?, NULL, NULL, 0, 0, ?, NULL)
          """,
        arguments: [id, "Board \(id)", syncSeq]
      )
    }
  }

  private func seedAlert(_ id: String, boardId: String, syncSeq: Int64) throws {
    try queue.write { db in
      try db.execute(
        sql: """
          INSERT INTO alerts
            (board_id, id, control_id, threshold, threshold_max, enabled, sound_type, created_at,
             source, updated_at, sync_seq)
          VALUES (?, ?, 'speed', 1.0, NULL, 1, 'beep', 0, NULL, 0, ?)
          """,
        arguments: [boardId, id, syncSeq]
      )
    }
  }

  private func seedFrame(id: Int64, boardId: String?) throws {
    try queue.write { db in
      try db.execute(
        sql: """
          INSERT INTO telemetry_frames
            (id, captured_at_ms, elapsed_realtime_ms, board_id, flags, changed_mask_1, changed_mask_2)
          VALUES (?, 0, 0, ?, 0, 0, 0)
          """,
        arguments: [id, boardId]
      )
    }
  }

  private func cursor(_ table: SyncTable) throws -> Int64 {
    try queue.read { db in try syncCursor(db, table.cursorKey) }
  }

  private func cursors(_ tables: [SyncPendingTable]) -> [SyncTable: [Int64]] {
    Dictionary(uniqueKeysWithValues: tables.map { ($0.table, $0.rows.map(\.cursor)) })
  }

  // The scan boundary.

  /// The single most consequential line of SQL in the feature: `>` and not `>=`. Off by one in
  /// either direction is silent — one re-sends the same row forever, the other never sends it.
  func testAScanServesOnlyRowsStrictlyPastTheCommittedCursor() throws {
    let store = store()
    try seedBoard("a", syncSeq: 1)
    try seedBoard("b", syncSeq: 2)
    try seedBoard("c", syncSeq: 3)

    XCTAssertEqual(cursors(try store.pending(rowLimit: 100))[.boards], [1, 2, 3])

    try store.commit([.boards: 2])

    XCTAssertEqual(cursors(try store.pending(rowLimit: 100))[.boards], [3])
    XCTAssertEqual(store.pendingCount(), 1)
  }

  /// A row written after the checkpoint gets a higher position, so it is picked up on the next pass
  /// without anything having to notice it arrived.
  func testARowWrittenAfterACheckpointIsPickedUpNext() throws {
    let store = store()
    try seedBoard("a", syncSeq: 1)
    try store.commit([.boards: 1])
    XCTAssertEqual(store.pendingCount(), 0)

    try seedBoard("b", syncSeq: 2)

    XCTAssertEqual(cursors(try store.pending(rowLimit: 100))[.boards], [2])
  }

  /// A late response carrying a stale checkpoint must not un-deliver rows the store already
  /// forgot — `commitSyncCursor` takes the higher of the two.
  func testACommitNeverMovesACursorBackwards() throws {
    let store = store()
    try seedBoard("a", syncSeq: 1)
    try seedBoard("b", syncSeq: 2)

    try store.commit([.boards: 2])
    try store.commit([.boards: 1])

    XCTAssertEqual(try cursor(.boards), 2)
    XCTAssertEqual(store.pendingCount(), 0)
  }

  /// Parents before children, one shared budget: a batch that cannot fit a Board must not spend the
  /// rest of its budget on that Board's Alert Rules.
  func testTheRowBudgetIsSharedAcrossTablesInServerOrder() throws {
    let store = store()
    try seedBoard("a", syncSeq: 1)
    try seedBoard("b", syncSeq: 2)
    try seedAlert("r1", boardId: "a", syncSeq: 1)
    try seedAlert("r2", boardId: "a", syncSeq: 2)

    let firstPass = try store.pending(rowLimit: 2)
    XCTAssertEqual(firstPass.map(\.table), [.boards], "the budget was spent before alerts")
    XCTAssertEqual(cursors(firstPass)[.boards], [1, 2])

    try store.commit([.boards: 2])

    let secondPass = try store.pending(rowLimit: 2)
    XCTAssertEqual(secondPass.map(\.table), [.alerts])
    XCTAssertEqual(cursors(secondPass)[.alerts], [1, 2])
  }

  /// The deliberate deviation in #284: a frame naming no Board can never be accepted, so it is not
  /// offered — and, critically, it does not hold the cursor back for the rows that can be.
  func testUnownedTelemetryIsNeitherOfferedNorAllowedToWedgeTheScan() throws {
    let store = store()
    try seedBoard("a", syncSeq: 1)
    try seedFrame(id: 1, boardId: nil)
    try seedFrame(id: 2, boardId: "a")

    let pending = try store.pending(rowLimit: 100)
    XCTAssertEqual(cursors(pending)[.telemetryFrames], [2], "the unowned frame must not be offered")
    XCTAssertEqual(store.pendingCount(), 2, "one board and one owned frame")

    try store.commit([.telemetryFrames: 2])
    XCTAssertNil(cursors(try store.pending(rowLimit: 100))[.telemetryFrames])
  }

  private func seedExclusionRange(id: Int64, boardId: String) throws {
    try queue.write { db in
      try db.execute(
        sql: """
          INSERT INTO metric_exclusion_ranges (id, board_id, reason, start_ms, end_ms, sample_count)
          VALUES (?, ?, 'idle', 0, 1, 0)
          """,
        arguments: [id, boardId]
      )
    }
  }

  /// A range recorded with no Board connected carries `UNKNOWN_TELEMETRY_BOARD_ID`, and the server's
  /// composite foreign key refuses it — which refuses the whole batch, and since the row is retained
  /// the same batch retries forever. Offering it once would wedge backup permanently.
  func testAnUnattributedExclusionRangeIsNeitherOfferedNorCounted() throws {
    let store = store()
    try seedBoard("a", syncSeq: 1)
    try seedExclusionRange(id: 1, boardId: UNKNOWN_TELEMETRY_BOARD_ID)
    try seedExclusionRange(id: 2, boardId: "a")

    let pending = try store.pending(rowLimit: 100)
    XCTAssertEqual(cursors(pending)[.metricExclusionRanges], [2])
    XCTAssertEqual(store.pendingCount(), 2, "one board and one owned range")
  }

  /// `pendingCount` drives the status line and the "send again immediately" decision. A count that
  /// disagrees with the scan reports a drained backlog while rows are still waiting.
  func testThePendingCountAgreesWithWhatTheScanWillActuallyOffer() throws {
    let store = store()
    try seedBoard("a", syncSeq: 1)
    try seedAlert("r1", boardId: "a", syncSeq: 1)
    try seedFrame(id: 1, boardId: nil)

    let offered = try store.pending(rowLimit: 1_000).reduce(0) { $0 + $1.rows.count }
    XCTAssertEqual(store.pendingCount(), offered)
  }

  // The whole loop, over the real store.

  /// The round trip: real database, real scan, real encoding, real cursor writes, real engine. The
  /// backlog has to reach zero, the server has to receive every row, and a second drain has to be
  /// idle — a cursor left short would keep re-sending, a cursor overshot would drop rows here.
  func testAWholeBacklogDrainsThroughTheRealStore() async throws {
    let store = store()
    for index in 1...12 { try seedBoard("board-\(index)", syncSeq: Int64(index)) }
    for index in 1...7 { try seedAlert("rule-\(index)", boardId: "board-1", syncSeq: Int64(index)) }
    for index in 1...5 { try seedFrame(id: Int64(index), boardId: "board-1") }

    let total = store.pendingCount()
    XCTAssertEqual(total, 24)

    let server = FakeSyncServer()
    let engine = SyncEngine(
      source: store,
      transport: { body in server.send(body) },
      environment: {
        SyncEnvironment(
          ridingSamples: false,
          enabled: true,
          online: true,
          wifiOnly: false,
          onWifi: false,
          credentialReady: true,
          onlineBlocked: false
        )
      },
      clock: { self.now }
    )

    var passes = 0
    while store.pendingCount() > 0, passes < 100 {
      switch await engine.runOnce() {
      case let .waiting(untilMs): now = max(now, untilMs) + 1
      case .paused: XCTFail("the drain must not pause"); return
      default: break
      }
      passes += 1
    }

    XCTAssertEqual(store.pendingCount(), 0)
    XCTAssertEqual(server.writes, total, "every row exactly once")
    XCTAssertEqual(try cursor(.boards), 12)
    XCTAssertEqual(try cursor(.alerts), 7)
    XCTAssertEqual(try cursor(.telemetryFrames), 5)

    // A drained backlog falls back to the idle poll rather than sending an empty batch.
    let requests = server.received.count
    _ = await engine.runOnce()
    XCTAssertEqual(server.received.count, requests, "a drained backlog must send nothing at all")
  }

  /// A checkpoint that never landed must leave every row pending. The server holds them, so the
  /// re-send is a no-op there — but the store cannot know that, and guessing costs the rows.
  func testAFailedCheckpointLeavesEveryRowPending() async throws {
    let store = store()
    for index in 1...4 { try seedBoard("board-\(index)", syncSeq: Int64(index)) }

    // A database that went away between the response and the checkpoint.
    let broken = SyncStore(generation: { 0 }, onPermanentFailure: { _, _ in }, database: { nil })
    XCTAssertThrowsError(try broken.commit([.boards: 4]))

    XCTAssertEqual(try cursor(.boards), 0)
    XCTAssertEqual(store.pendingCount(), 4)
  }
}
