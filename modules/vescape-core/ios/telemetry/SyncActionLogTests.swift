import XCTest
import GRDB
@testable import VescapeCore

/// The Sync Action log (#282): an append-only record of semantic removals, which no surviving row
/// can express. A deleted row cannot carry a Change Timestamp saying it is gone.
///
/// Runs the real migrator and the real repositories/stores against an in-memory database. The
/// Android peer asserts the same classification against the DAO source, because Room keeps its SQL
/// out of reach of a JVM unit test.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/telemetry/SyncActionLogTest.kt
final class SyncActionLogTests: XCTestCase {
  private var queue: DatabaseQueue!
  private var repo: AppDataRepository!

  override func setUpWithError() throws {
    queue = try DatabaseQueue()
    try TelemetryDatabase.migrator.migrate(queue)
    repo = AppDataRepository.forTesting(dbWriter: queue)
  }

  override func tearDownWithError() throws {
    repo = nil
    queue = nil
  }

  // MARK: Helpers

  private func actions() throws -> [SyncAction] {
    try queue.read { db in try syncActionsAfter(db, 0, limit: 100) }
  }

  private func seedBoard(_ id: String = "board-1") {
    repo.upsertBoard([
      "id": id,
      "name": "ADV",
      "createdAt": Int64(1000),
      "description": "trail board",
      "link": ["bleId": "AA:BB", "transport": "direct"] as [String: Any?],
    ])
  }

  private func seedFavorite(_ id: String = "fav-1") {
    FavoriteStore(dbWriter: queue).insert(
      Favorite(
        id: id,
        boardId: "board-1",
        name: "commute",
        startMs: 1000,
        endMs: 2000,
        createdAtMs: 1000,
        updatedAtMs: 1000,
        summary: FavoriteSummary()
      )
    )
  }

  private func seedWarning(kind: String, lastDetectedAt: Int64) {
    BoardWarningStore(dbWriter: queue).upsert(
      BoardWarning(
        boardId: "board-1",
        kind: kind,
        severity: "warn",
        firstDetectedAtMs: 500,
        lastDetectedAtMs: lastDetectedAt,
        payloadJson: "{}"
      )
    )
  }

  // MARK: The seven Rider-facing removals

  func testDeletingAnAlertRuleEmitsOneAction() throws {
    seedBoard()
    repo.upsertAlertRule(["boardId": "board-1", "id": "rule-1", "controlId": "speed"])

    repo.deleteAlertRule("board-1", "rule-1")

    let actions = try self.actions()
    XCTAssertEqual(actions.count, 1)
    XCTAssertEqual(actions.first?.type, "delete")
    XCTAssertEqual(actions.first?.target, DeleteTarget.alert.rawValue)
    XCTAssertEqual(actions.first?.boardId, "board-1")
    XCTAssertEqual(actions.first?.key, "rule-1")
  }

  func testDeletingAPrivacyZoneEmitsOneAction() throws {
    repo.upsertPrivacyZone([
      "id": "zone-1", "name": "home", "centerLatitude": 52.0, "centerLongitude": 21.0,
      "radiusMeters": Int64(100),
    ])

    repo.deletePrivacyZone("zone-1")

    XCTAssertEqual(try actions().map { ($0.target, $0.key) }.map { "\($0.0):\($0.1)" }, ["privacyZone:zone-1"])
  }

  func testResettingAnAppSettingToItsDefaultEmitsAnAction() throws {
    repo.updateSetting("telemetryPollRateHz", rawValue: 50)

    repo.updateSetting("telemetryPollRateHz", rawValue: nil)

    let actions = try self.actions()
    XCTAssertEqual(actions.count, 1)
    XCTAssertEqual(actions.first?.target, DeleteTarget.appSetting.rawValue)
    XCTAssertNil(actions.first?.boardId, "an app setting is not Board-owned")
    XCTAssertEqual(actions.first?.key, "telemetryPollRateHz")
  }

  /// A phone-local key never reaches the server, so its removal has nothing to tell the server about.
  func testRemovingAPhoneLocalSettingEmitsNoAction() throws {
    repo.updateSetting("selectedBoardId", rawValue: "board-1")

    repo.updateSetting("selectedBoardId", rawValue: nil)

    XCTAssertEqual(try actions().count, 0)
    XCTAssertNil(try queue.read { db in
      try String.fetchOne(db, sql: "SELECT value_json FROM app_settings WHERE key = 'selectedBoardId'")
    })
  }

  func testClearingLegalPolicyEmitsAnAppSettingAction() throws {
    repo.updateLegalPolicy(jurisdictionCode: "PL")

    repo.updateLegalPolicy(jurisdictionCode: nil)

    XCTAssertEqual(try actions().map(\.key), ["legalPolicy"])
    XCTAssertEqual(try actions().map(\.target), [DeleteTarget.appSetting.rawValue])
  }

  /// A Board edit that drops a key is the Rider clearing that setting.
  func testDroppingABoardSettingKeyEmitsAnAction() throws {
    seedBoard()

    repo.upsertBoard([
      "id": "board-1",
      "name": "ADV",
      "createdAt": Int64(1000),
      "description": "",
      "link": ["bleId": "AA:BB", "transport": "direct"] as [String: Any?],
    ])

    let actions = try self.actions()
    XCTAssertEqual(actions.map(\.target), [DeleteTarget.boardSetting.rawValue])
    XCTAssertEqual(actions.first?.boardId, "board-1")
    XCTAssertEqual(actions.first?.key, "description")
  }

  func testDeletingATuneProfileEmitsOneActionAndItsHistoryNone() throws {
    let store = TuneProfileStore(dbWriter: queue)
    _ = try store.createProfile(
      boardId: "board-1", name: "keep", icon: "sliders-horizontal", color: "purple",
      fields: [:], refloatBaseVersion: "1.3.0"
    )
    let doomed = try store.createProfile(
      boardId: "board-1", name: "drop", icon: "sliders-horizontal", color: "purple",
      fields: [:], refloatBaseVersion: "1.3.0"
    )
    let id = doomed["id"] as! String

    try store.deleteProfile(profileId: id)

    let actions = try self.actions()
    XCTAssertEqual(actions.count, 1, "Tune History is parent-covered")
    XCTAssertEqual(actions.first?.target, DeleteTarget.tuneProfile.rawValue)
    XCTAssertEqual(actions.first?.key, id)
  }

  func testDeletingAFavoriteEmitsOneActionAndItsMediaNone() throws {
    seedFavorite()
    try queue.write { db in
      try db.execute(
        sql: """
          INSERT INTO favorite_media (id, favorite_id, captured_at, mime_type, media_kind, byte_count, content_hash, created_at)
          VALUES ('media-1', 'fav-1', NULL, 'image/jpeg', 'photo', 10, 'hash', 1000)
          """
      )
    }

    XCTAssertTrue(FavoriteStore(dbWriter: queue).delete("fav-1"))

    let actions = try self.actions()
    XCTAssertEqual(actions.count, 1, "the Favorite's action covers its manifest rows")
    XCTAssertEqual(actions.first?.target, DeleteTarget.favorite.rawValue)
    XCTAssertEqual(actions.first?.key, "fav-1")
  }

  /// An automatic clear after a clean detector evaluation is still a durable state transition.
  func testClearingABoardWarningEmitsAnActionStampedFromItsDetection() throws {
    seedWarning(kind: "cell-spread", lastDetectedAt: 9_000_000_000_000)

    XCTAssertTrue(BoardWarningStore(dbWriter: queue).delete("board-1", "cell-spread"))

    let actions = try self.actions()
    XCTAssertEqual(actions.count, 1)
    XCTAssertEqual(actions.first?.target, DeleteTarget.boardWarning.rawValue)
    XCTAssertEqual(actions.first?.boardId, "board-1")
    XCTAssertEqual(actions.first?.key, "cell-spread")
    XCTAssertEqual(
      actions.first?.deletedAt, 9_000_000_000_000,
      "a detection in the future outranks the wall clock, or the server drops the action"
    )
  }

  /// Clearing every warning on a Board is one action per row — each row is its own current state.
  func testClearingAllWarningsForABoardEmitsOneActionPerRow() throws {
    seedWarning(kind: "cell-spread", lastDetectedAt: 1_000)
    seedWarning(kind: "footpad-disabled", lastDetectedAt: 2_000)

    XCTAssertTrue(BoardWarningStore(dbWriter: queue).deleteForBoard("board-1"))

    XCTAssertEqual(try actions().map(\.key).sorted(), ["cell-spread", "footpad-disabled"])
  }

  // MARK: The Board tombstone

  func testDeletingABoardEmitsOneActionAndNoneForItsCascade() throws {
    seedBoard()
    repo.upsertAlertRule(["boardId": "board-1", "id": "rule-1", "controlId": "speed"])
    seedWarning(kind: "cell-spread", lastDetectedAt: 1_000)

    repo.deleteBoard("board-1")

    let actions = try self.actions()
    XCTAssertEqual(actions.map(\.target), [DeleteTarget.board.rawValue])
    XCTAssertEqual(actions.first?.key, "board-1")
    XCTAssertNil(actions.first?.boardId, "a Board is Account-owned; it names itself in `key`")

    let row = try queue.read { db in
      try Row.fetchOne(db, sql: "SELECT deleted_at, updated_at FROM boards WHERE id = 'board-1'")
    }
    XCTAssertEqual(row?["deleted_at"] as Int64?, actions.first?.deletedAt)
    XCTAssertEqual(row?["updated_at"] as Int64?, actions.first?.deletedAt)
  }

  // MARK: Stamping

  /// A rewound clock would otherwise stamp the action below the row the server already holds, and
  /// the action would be dropped as a no-op with no row left to re-send.
  func testDeletionStampNeverFallsBelowTheRemovedRow() throws {
    let future: Int64 = 9_000_000_000_000
    try queue.write { db in
      try db.execute(
        sql: """
          INSERT INTO privacy_zones
            (id, preset, name, enabled, center_latitude_e7, center_longitude_e7, radius_meters, created_at, updated_at, sync_seq)
          VALUES ('zone-1', 'custom', 'home', 1, 0, 0, 100, 0, ?, 1)
          """,
        arguments: [future]
      )
    }

    repo.deletePrivacyZone("zone-1")

    XCTAssertEqual(try actions().first?.deletedAt, future)
  }

  /// Nothing removed, nothing to say.
  func testDeletingAMissingRowEmitsNoAction() throws {
    repo.deletePrivacyZone("does-not-exist")
    repo.deleteAlertRule("board-1", "missing")

    XCTAssertEqual(try actions().count, 0)
  }

  // MARK: Retention

  /// The whole reason Ride History has no target: a retention sweep must not reach this log.
  func testRetentionWritesNoActions() throws {
    try queue.write { db in
      try db.execute(
        sql: "INSERT INTO telemetry_markers (occurred_at_ms, elapsed_realtime_ms, type) VALUES (1, 1, 'start')"
      )
      try db.execute(sql: "DELETE FROM telemetry_markers WHERE occurred_at_ms < 100")
    }

    XCTAssertEqual(try actions().count, 0)
  }

  // MARK: Cursor and pruning

  /// The accepted cursor commits first; pruning reads it back rather than trusting a caller. A crash
  /// between the two re-sends an action, which is a no-op — pruning first would lose one.
  func testPruningOnlyRemovesWhatTheCursorHasAccepted() throws {
    seedFavorite("fav-1")
    seedFavorite("fav-2")
    FavoriteStore(dbWriter: queue).delete("fav-1")
    FavoriteStore(dbWriter: queue).delete("fav-2")
    let logged = try actions()
    XCTAssertEqual(logged.count, 2)

    XCTAssertEqual(try queue.write { db in try pruneUploadedSyncActions(db) }, 0)
    XCTAssertEqual(try actions().count, 2, "nothing is accepted yet")

    try queue.write { db in try commitSyncActionCursor(db, throughId: logged[0].id) }
    XCTAssertEqual(try queue.write { db in try pruneUploadedSyncActions(db) }, 1)
    XCTAssertEqual(try actions().map(\.id), [logged[1].id])
  }

  func testTheAcceptedCursorNeverMovesBackwards() throws {
    try queue.write { db in
      try commitSyncActionCursor(db, throughId: 10)
      try commitSyncActionCursor(db, throughId: 3)
    }

    let cursor = try queue.read { db in
      try Int64.fetchOne(
        db,
        sql: "SELECT last_value FROM sync_sequences WHERE name = ?",
        arguments: [syncActionsUploadedCursor]
      )
    }
    XCTAssertEqual(cursor, 10)
  }

  // MARK: Schema

  func testTheLogIsKeyedOnAnAutoincrementCursor() throws {
    let sql = try queue.read { db in
      try String.fetchOne(db, sql: "SELECT sql FROM sqlite_master WHERE name = 'sync_actions'")
    }
    XCTAssertTrue(sql?.contains("AUTOINCREMENT") ?? false, sql ?? "missing sync_actions")

    let triggers = try queue.read { db in
      try String.fetchAll(db, sql: "SELECT name FROM sqlite_master WHERE type = 'trigger'")
    }
    XCTAssertEqual(triggers, [], "intent cannot be inferred from SQL — no trigger writes the log")
  }

  func testMigrationIsANoOpOnReRun() throws {
    XCTAssertNoThrow(try TelemetryDatabase.migrator.migrate(queue))
  }

  /// The retention boundary, made structural: a target can only name configuration or current state.
  /// Mirrors the server's `DELETE_ACTION_TARGETS` test.
  func testNoRetainedTableCanBeNamedByADeleteTarget() {
    let retained: Set<String> = [
      "telemetry_frames",
      "telemetry_markers",
      "telemetry_minute_buckets",
      "metric_exclusion_ranges",
      "diagnostic_events",
      "tune_history_entries",
      "favorite_media",
      "sync_actions",
      "sync_sequences",
    ]
    let named = Set(DeleteTarget.allCases.map(\.table))

    XCTAssertEqual(named.intersection(retained), [])
    XCTAssertEqual(named.count, DeleteTarget.allCases.count)
  }

  /// Every raw `DELETE FROM` against a syncable table has to sit in a file that is allowed to write
  /// one — the delete-owning stores, where each statement is either parent-covered or maintenance.
  /// A new raw delete elsewhere fails here rather than silently skipping the log.
  func testEverySyncableDeleteLivesInADeleteOwningStore() throws {
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
    let owners: Set<String> = [
      "AppDataRepository.swift",
      "TuneProfileStore.swift",
      "FavoriteStore.swift",
      "BoardWarningStore.swift",
      "SyncActionLog.swift",
      // Schema migrations are maintenance: they rewrite what a table holds, never Rider intent.
      "TelemetryDatabase.swift",
    ]
    let syncable = Set(DeleteTarget.allCases.map(\.table))

    let files = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil)?
      .compactMap { $0 as? URL }
      .filter { $0.pathExtension == "swift" && !$0.lastPathComponent.hasSuffix("Tests.swift") } ?? []

    for file in files where !owners.contains(file.lastPathComponent) {
      let source = try String(contentsOf: file, encoding: .utf8)
      for table in syncable {
        XCTAssertFalse(
          source.contains("DELETE FROM \(table)"),
          "\(file.lastPathComponent) deletes from \(table) outside a Sync Action-owning store"
        )
      }
    }
  }
}
