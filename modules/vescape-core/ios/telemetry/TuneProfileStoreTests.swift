import XCTest
import GRDB
@testable import VescapeCore

final class TuneProfileStoreTests: XCTestCase {
  private var queue: DatabaseQueue!
  private var store: TuneProfileStore!

  override func setUpWithError() throws {
    queue = try DatabaseQueue()
    try queue.write { db in try TuneProfileStore.createTables(db) }
    store = TuneProfileStore(dbWriter: queue)
  }

  override func tearDownWithError() throws {
    store = nil
    queue = nil
  }

  private func fieldsOf(_ profile: [String: Any?]) -> [String: Any] {
    (profile["fields"] as? [String: Any]) ?? [:]
  }

  private func createProfile(
    boardId: String,
    name: String,
    fields: [String: Any],
    refloatBaseVersion: String = "1.3.0"
  ) throws -> [String: Any?] {
    try store.createProfile(
      boardId: boardId,
      name: name,
      fields: fields,
      refloatBaseVersion: refloatBaseVersion
    )
  }

  func testCreateSeedsProfileAndFirstHistoryEntry() throws {
    let profile = try createProfile(boardId: "board-1", name: "Race", fields: ["speed": 42])
    let id = profile["id"] as! String

    XCTAssertEqual(profile["boardId"] as? String, "board-1")
    XCTAssertEqual(profile["refloatBaseVersion"] as? String, "1.3")
    XCTAssertEqual(profile["name"] as? String, "Race")
    XCTAssertEqual(fieldsOf(profile)["speed"] as? Int, 42)
  }

  func testSaveUpdatesProfileFields() throws {
    let created = try createProfile(boardId: "board-1", name: "Race", fields: ["speed": 10])
    let id = created["id"] as! String

    let saved = try store.saveProfile(profileId: id, fields: ["speed": 20])
    XCTAssertEqual(fieldsOf(saved)["speed"] as? Int, 20)
  }

  func testSaveOnMissingProfileThrowsNotFound() {
    XCTAssertThrowsError(try store.saveProfile(profileId: "nope", fields: [:])) { error in
      XCTAssertEqual((error as? TuneProfileError)?.errorDescription, "Tune Profile not found: nope")
    }
  }

  func testCopyToBoardClonesFields() throws {
    let source = try createProfile(boardId: "board-1", name: "Race", fields: ["speed": 55, "duty": 80])
    let sourceId = source["id"] as! String

    let copy = try store.copyProfileToBoard(profileId: sourceId, targetBoardId: "board-2", newName: "Race (copy)")
    let copyId = copy["id"] as! String

    XCTAssertNotEqual(copyId, sourceId)
    XCTAssertEqual(copy["boardId"] as? String, "board-2")
    XCTAssertEqual(copy["name"] as? String, "Race (copy)")
    XCTAssertEqual(fieldsOf(copy)["speed"] as? Int, 55)
    XCTAssertEqual(fieldsOf(copy)["duty"] as? Int, 80)

    XCTAssertEqual(try store.getTuneProfiles("board-2", refloatBaseVersion: "1.3.0").map { $0["id"] as! String }, [copyId])
  }

  func testListsOnlyProfilesForRequestedRefloatBaseVersion() throws {
    let current = try createProfile(boardId: "board-1", name: "Current", fields: ["speed": 55], refloatBaseVersion: "1.3.0")
    _ = try createProfile(boardId: "board-1", name: "Older", fields: ["speed": 44], refloatBaseVersion: "1.2.0")

    let profiles = try store.getTuneProfiles("board-1", refloatBaseVersion: "1.3.0")

    XCTAssertEqual(profiles.map { $0["id"] as! String }, [current["id"] as! String])
  }

  func testAcceptsLegacyTwoPartRefloatCompatibility() throws {
    _ = try createProfile(
      boardId: "board-1",
      name: "Legacy",
      fields: ["speed": 44],
      refloatBaseVersion: "1.1"
    )

    XCTAssertEqual(try store.getTuneProfiles("board-1", refloatBaseVersion: "1.1").count, 1)
  }

  func testUnscopedProfilesAreIgnored() throws {
    try queue.write { db in
      try db.execute(
        sql: """
          INSERT INTO tune_profiles (id, board_id, refloat_base_version, name, fields_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          """,
        arguments: ["legacy", "board-1", "", "Legacy", "{}", 1000, 1000]
      )
    }

    XCTAssertTrue(try store.getTuneProfiles("board-1", refloatBaseVersion: "1.3.0").isEmpty)
    XCTAssertTrue(try store.getTuneProfiles("board-1", refloatBaseVersion: nil).isEmpty)
  }

  func testDatabaseUnavailableIsDistinctFromNoProfiles() {
    let unavailable = TuneProfileStore { nil }
    XCTAssertThrowsError(try unavailable.getTuneProfiles("board-1", refloatBaseVersion: "1.3.0"))
    XCTAssertThrowsError(try unavailable.getTuneProfile("missing"))
  }

  func testMalformedStoredFieldsThrowInsteadOfBecomingEmptyTune() throws {
    try queue.write { db in
      try db.execute(
        sql: """
          INSERT INTO tune_profiles (id, board_id, refloat_base_version, name, fields_json, created_at, updated_at)
          VALUES ('broken', 'board-1', '1.3.0', 'Broken', 'not-json', 1, 1)
          """
      )
    }

    XCTAssertThrowsError(try store.getTuneProfile("broken"))
    XCTAssertThrowsError(try store.getTuneProfiles("board-1", refloatBaseVersion: "1.3.0"))
  }

  func testCopyMissingSourceThrows() {
    XCTAssertThrowsError(
      try store.copyProfileToBoard(profileId: "nope", targetBoardId: "board-2", newName: "x")
    ) { error in
      XCTAssertEqual((error as? TuneProfileError)?.errorDescription, "Source profile not found: nope")
    }
  }

  func testDeleteRefusesLastProfileForBoard() throws {
    let only = try createProfile(boardId: "board-1", name: "Only", fields: [:])
    XCTAssertThrowsError(try store.deleteProfile(profileId: only["id"] as! String)) { error in
      XCTAssertEqual(
        (error as? TuneProfileError)?.errorDescription,
        "Cannot delete the last profile for a board"
      )
    }
  }

  func testDeleteRemovesProfile() throws {
    _ = try createProfile(boardId: "board-1", name: "Keep", fields: [:])
    let victim = try createProfile(boardId: "board-1", name: "Drop", fields: [:])
    let victimId = victim["id"] as! String

    try store.deleteProfile(profileId: victimId)

    XCTAssertNil(try store.getTuneProfile(victimId))
    XCTAssertEqual(try store.getTuneProfiles("board-1", refloatBaseVersion: "1.3.0").count, 1)
  }

  func testRenameUpdatesNameAndThrowsWhenMissing() throws {
    let created = try createProfile(boardId: "board-1", name: "Old", fields: [:])
    let renamed = try store.renameProfile(profileId: created["id"] as! String, name: "New")
    XCTAssertEqual(renamed["name"] as? String, "New")

    XCTAssertThrowsError(try store.renameProfile(profileId: "nope", name: "x")) { error in
      XCTAssertEqual((error as? TuneProfileError)?.errorDescription, "Tune Profile not found: nope")
    }
  }
}
