import GRDB
import XCTest

@testable import VescapeCore

/// The durable half of a **Ride Recording**'s lifetime (#450): which recording a Board Session may
/// rejoin, and which one it may never touch again.
///
/// A recording outlives its Board Link. Unexpected BLE loss, a reconnect loop of any length, an Idle
/// Pause and process death all leave the row open, and GPS keeps landing in it. The only things that
/// close it are the rider's explicit Stop Recording or Disconnect, and an explicit Connect to
/// another Board. Once `ended_at_ms` is stamped it is stamped forever — that column *is* the
/// persisted end intent, and it is what stops a stale delegate callback, a late reconnect, or an iOS
/// BLE state-restoration relaunch from reviving a ride the rider ended.
///
/// Asserted against a real in-memory database rather than a mock, because the guarantee being tested
/// is a SQL one. The Android peer mirrors the same policy but cannot run this: its JVM test source
/// set has no SQLite (see `RideTrackMigrationTest`), and only iOS has the restoration relaunch that
/// rejoins a recording at all.
final class RideRecordingLifecycleTests: XCTestCase {
  private var queue: DatabaseQueue!

  override func setUpWithError() throws {
    queue = try DatabaseQueue()
    try TelemetryDatabase.migrator.migrate(queue)
  }

  override func tearDownWithError() throws {
    queue = nil
  }

  @discardableResult
  private func open(id: String, boardId: String?, startedAtMs: Int64 = 1_000) throws -> String {
    try queue.write { db in
      try insertRideRecording(
        db,
        RideRecording(
          id: id, boardId: boardId, startedAtMs: startedAtMs, endedAtMs: nil, endedReason: nil)
      )
    }
    return id
  }

  private func openRecording(boardId: String?) throws -> RideRecording? {
    try queue.read { db in try openRideRecordingForBoard(db, boardId: boardId) }
  }

  private func endedReason(_ id: String) throws -> String? {
    try queue.read { db in
      try String.fetchOne(db, sql: "SELECT ended_reason FROM ride_recordings WHERE id = ?", arguments: [id])
    }
  }

  // MARK: - Rejoining an open recording

  /// The reconnect case the whole issue is about: the rider's Board dropped, the recording stayed
  /// open, and the session that comes back must find the very same identity rather than a new one.
  func testOpenRecordingIsFoundForItsBoard() throws {
    try open(id: "rec-a", boardId: "board-a")

    XCTAssertEqual(try openRecording(boardId: "board-a")?.id, "rec-a")
  }

  /// Board attribution is not recording identity, but it does scope the rejoin: Board B must never
  /// be handed Board A's open recording, or one ride's fixes would land under another's.
  func testOpenRecordingIsScopedToItsBoard() throws {
    try open(id: "rec-a", boardId: "board-a")

    XCTAssertNil(try openRecording(boardId: "board-b"))
  }

  /// A recording with no Board attribution is its own scope, not a wildcard that any Board matches.
  func testNilBoardMatchesOnlyNilBoardRecordings() throws {
    try open(id: "rec-a", boardId: "board-a")
    try open(id: "rec-none", boardId: nil, startedAtMs: 2_000)

    XCTAssertEqual(try openRecording(boardId: nil)?.id, "rec-none")
    XCTAssertEqual(try openRecording(boardId: "board-a")?.id, "rec-a")
  }

  /// With more than one open row for a Board — a state only a crash can produce — the rejoin takes
  /// the newest, never an older ride the rider has long since finished riding.
  func testNewestOpenRecordingWins() throws {
    try open(id: "rec-old", boardId: "board-a", startedAtMs: 1_000)
    try open(id: "rec-new", boardId: "board-a", startedAtMs: 5_000)

    XCTAssertEqual(try openRecording(boardId: "board-a")?.id, "rec-new")
  }

  // MARK: - Persisted end intent

  /// Explicit Stop Recording. A restoration relaunch or a late reconnect callback asking for this
  /// Board's open recording must come back empty-handed: the rider ended that ride, and reopening it
  /// would resurrect a recording they stopped.
  func testStoppedRecordingIsNeverRejoinable() throws {
    try open(id: "rec-a", boardId: "board-a")
    try queue.write { db in
      try closeRideRecordingRow(db, id: "rec-a", endedAtMs: 2_000, reason: RIDE_RECORDING_END_STOPPED)
    }

    XCTAssertNil(try openRecording(boardId: "board-a"))
  }

  /// Explicit Disconnect ends the recording just as a Stop does, and just as durably.
  func testDisconnectedRecordingIsNeverRejoinable() throws {
    try open(id: "rec-a", boardId: "board-a")
    try queue.write { db in
      try closeRideRecordingRow(db, id: "rec-a", endedAtMs: 2_000, reason: RIDE_RECORDING_END_DISCONNECTED)
    }

    XCTAssertNil(try openRecording(boardId: "board-a"))
  }

  /// The end intent is write-once. A stale callback that races a second close — the same shape as a
  /// restored session finishing after the rider already stopped — cannot rewrite when or why the
  /// ride ended.
  func testClosingAnEndedRecordingAgainDoesNotOverwriteIt() throws {
    try open(id: "rec-a", boardId: "board-a")
    try queue.write { db in
      try closeRideRecordingRow(db, id: "rec-a", endedAtMs: 2_000, reason: RIDE_RECORDING_END_STOPPED)
      try closeRideRecordingRow(db, id: "rec-a", endedAtMs: 9_000, reason: RIDE_RECORDING_END_BOARD_CHANGE)
    }

    XCTAssertEqual(try endedReason("rec-a"), RIDE_RECORDING_END_STOPPED)
    let endedAt = try queue.read { db in
      try Int64.fetchOne(db, sql: "SELECT ended_at_ms FROM ride_recordings WHERE id = ?", arguments: ["rec-a"])
    }
    XCTAssertEqual(endedAt, 2_000)
  }

  // MARK: - Recordings abandoned by a dead process

  /// A process that died without ending its recording leaves the row open. The next recording to be
  /// minted is the moment that old one becomes unrejoinable, so it is closed then — a `disconnected`
  /// end, because that is what happened to the link.
  func testMintingANewRecordingClosesAbandonedOnes() throws {
    try open(id: "rec-dead", boardId: "board-a")

    let closed = try queue.write { db in
      try closeAbandonedRideRecordings(
        db, endedAtMs: 8_000, reason: RIDE_RECORDING_END_DISCONNECTED, except: "rec-new")
    }

    XCTAssertEqual(closed, 1)
    XCTAssertEqual(try endedReason("rec-dead"), RIDE_RECORDING_END_DISCONNECTED)
  }

  /// The recording being opened must survive its own sweep — otherwise every new recording would
  /// close itself the instant it started.
  func testAbandonedSweepSparesTheIncomingRecording() throws {
    try open(id: "rec-new", boardId: "board-a")

    try queue.write { db in
      _ = try closeAbandonedRideRecordings(
        db, endedAtMs: 8_000, reason: RIDE_RECORDING_END_DISCONNECTED, except: "rec-new")
    }

    XCTAssertEqual(try openRecording(boardId: "board-a")?.id, "rec-new")
  }

  /// Sweeping abandoned rows must not re-close, or re-date, recordings the rider already ended.
  func testAbandonedSweepLeavesEndedRecordingsAlone() throws {
    try open(id: "rec-stopped", boardId: "board-a")
    try queue.write { db in
      try closeRideRecordingRow(db, id: "rec-stopped", endedAtMs: 2_000, reason: RIDE_RECORDING_END_STOPPED)
      _ = try closeAbandonedRideRecordings(
        db, endedAtMs: 8_000, reason: RIDE_RECORDING_END_DISCONNECTED, except: nil)
    }

    XCTAssertEqual(try endedReason("rec-stopped"), RIDE_RECORDING_END_STOPPED)
  }

  // MARK: - Board change

  /// An explicit Connect to another Board ends the previous recording immediately — including while
  /// the old Board is still disconnected and reconnecting, and whether or not the new Board ever
  /// connects. Afterwards neither Board can rejoin it.
  func testBoardChangeEndsThePreviousRecordingForBothBoards() throws {
    try open(id: "rec-a", boardId: "board-a")
    try queue.write { db in
      try closeRideRecordingRow(db, id: "rec-a", endedAtMs: 3_000, reason: RIDE_RECORDING_END_BOARD_CHANGE)
    }

    XCTAssertNil(try openRecording(boardId: "board-a"))
    XCTAssertNil(try openRecording(boardId: "board-b"))
    XCTAssertEqual(try endedReason("rec-a"), RIDE_RECORDING_END_BOARD_CHANGE)
  }
}
