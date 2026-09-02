import XCTest
@testable import VescapeCore

/// The invariant the whole uploader exists to hold: **a row the Rider owns is never left behind.**
///
/// Every other sync test checks one decision in isolation. These run a backlog all the way to zero
/// against a server that stores what it is sent and a source that scans forward from what was
/// committed, then compare the two sets. That closes the loop the unit tests leave open — a cursor
/// advanced past a row that never went in a batch is indistinguishable from a correct pass when you
/// only look at the engine's return value.
///
/// The direction of failure is asserted too: after a lost response or a lost checkpoint, rows may be
/// re-sent (the server upserts them) but must never be skipped.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/sync/SyncDrainTest.kt
final class SyncDrainTests: XCTestCase {

  private var now: Int64 = 1_000

  override func setUp() {
    super.setUp()
    now = 1_000
  }

  private func engine(_ source: SyncSource, _ server: FakeSyncServer) -> SyncEngine {
    SyncEngine(
      source: source,
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
  }

  /// Runs passes until the backlog is drained, stepping the clock over any backoff so a transient
  /// failure costs a wait rather than ending the test. Bounded: a loop that stops making progress
  /// fails here rather than hanging.
  private func drain(_ engine: SyncEngine, _ source: FakeSyncSource, maxPasses: Int = 200) async {
    var passes = 0
    while source.remaining > 0, passes < maxPasses {
      switch await engine.runOnce() {
      case let .waiting(untilMs): now = max(now, untilMs) + 1
      case .paused: return
      default: break
      }
      passes += 1
    }
  }

  private func backlog(_ tables: [SyncTable: Int]) -> FakeSyncSource {
    FakeSyncSource(tables.mapValues { count in (1...Int64(count)).map { $0 } })
  }

  func testAFullDrainDeliversEveryRowExactlyOnce() async {
    let source = backlog([.boards: 5, .favorites: 3])
    let server = FakeSyncServer()

    await drain(engine(source, server), source)

    XCTAssertEqual(source.allRows(), server.stored)
    XCTAssertEqual(source.remaining, 0)
    // Nothing failed, so nothing had to be re-sent.
    XCTAssertEqual(server.writes, source.allRows().count)
  }

  /// The scan is the only thing that decides what goes next, so a small budget must not open a gap.
  func testABacklogLargerThanOneScanStillLosesNothing() async {
    let source = backlog([.boards: 17, .alerts: 11, .favorites: 4])
    source.scanLimit = 3
    let server = FakeSyncServer()

    await drain(engine(source, server), source)

    XCTAssertEqual(source.allRows(), server.stored)
    XCTAssertEqual(server.writes, source.allRows().count)
  }

  /// The response was lost, not the write. The engine cannot tell those apart, so it re-sends — and
  /// the rows must arrive, once, because the server upserts on identity.
  func testABatchStoredButNeverAcknowledgedIsResentNotSkipped() async {
    let source = backlog([.boards: 6])
    source.scanLimit = 2
    let server = FakeSyncServer()
    server.loseNextResponse = true
    let engine = engine(source, server)

    _ = await engine.runOnce()
    XCTAssertTrue(server.stored.contains(SyncRowRef(table: .boards, cursor: 1)))
    XCTAssertTrue(source.committed.isEmpty, "nothing may be checkpointed")

    await drain(engine, source)

    XCTAssertEqual(source.allRows(), server.stored)
    XCTAssertEqual(source.remaining, 0)
  }

  /// The server took the rows; the checkpoint did not land. Re-sending is the only safe direction.
  func testALostCursorCommitResendsTheSameRowsAndStillDrains() async {
    let source = backlog([.boards: 6])
    source.scanLimit = 2
    let server = FakeSyncServer()
    source.commitFailure = SyncStoreError.databaseUnavailable

    let engine = engine(source, server)
    _ = await engine.runOnce()
    XCTAssertTrue(source.committed.isEmpty, "nothing may be checkpointed")
    XCTAssertEqual(source.remaining, 6)

    source.commitFailure = nil
    await drain(engine, source)

    XCTAssertEqual(source.allRows(), server.stored)
    // The first batch went twice: failing toward a re-send is the whole design.
    XCTAssertGreaterThan(server.writes, source.allRows().count)
  }

  func testATransientFailurePartWayThroughADrainLosesNothing() async {
    let source = backlog([.boards: 9, .privacyZones: 5])
    source.scanLimit = 2
    let server = FakeSyncServer()
    let engine = engine(source, server)

    _ = await engine.runOnce()
    server.failures = [
      .transient(reason: "5xx"),
      .transient(reason: "5xx"),
      .rateLimited(retryAfterMs: 30_000),
    ]

    await drain(engine, source)

    XCTAssertEqual(source.allRows(), server.stored)
    XCTAssertEqual(source.remaining, 0)
  }

  /// A committed cursor is a promise that everything below it reached the server. Checked after
  /// every pass rather than at the end, because a mid-drain violation self-heals by the time the
  /// backlog is empty and would otherwise go unseen.
  func testNoCursorEverMovesPastARowTheServerDoesNotHold() async {
    let source = backlog([.boards: 8, .alerts: 6, .favorites: 5])
    source.scanLimit = 3
    let server = FakeSyncServer()
    server.failures = [.transient(reason: "5xx")]
    let engine = engine(source, server)

    var passes = 0
    while source.remaining > 0, passes < 100 {
      switch await engine.runOnce() {
      case let .waiting(untilMs): now = max(now, untilMs) + 1
      case .paused: passes = 100
      default: break
      }
      for (table, cursor) in source.cursors where cursor > 0 {
        for position in 1...cursor {
          XCTAssertTrue(
            server.stored.contains(SyncRowRef(table: table, cursor: position)),
            "\(table) cursor reached \(cursor) but the server never received \(position)"
          )
        }
      }
      passes += 1
    }

    XCTAssertEqual(source.allRows(), server.stored)
  }

  /// The Account changed while the request was in flight. The response belongs to the previous
  /// database, so nothing may be checkpointed — and every row stays pending for whoever owns it now.
  func testAResponseThatOutlivedItsAccountCheckpointsNothingAndStrandsNoRow() async {
    let source = backlog([.boards: 4])
    let server = FakeSyncServer()
    server.afterStore = { source.currentGeneration += 1 }

    let pass = await engine(source, server).runOnce()

    XCTAssertEqual(pass, .idle)
    XCTAssertTrue(source.committed.isEmpty)
    XCTAssertTrue(source.cursors.isEmpty)
    XCTAssertEqual(source.remaining, 4)
  }

  /// A permanent pause must strand the batch in place: retained, not consumed.
  func testARefusedBatchLeavesTheWholeBacklogPending() async {
    let source = backlog([.boards: 4, .favorites: 2])
    let server = FakeSyncServer()
    server.failures = [.invalid(status: 409, error: "dependency-conflict")]

    let pass = await engine(source, server).runOnce()

    XCTAssertEqual(pass, .paused(.protocolFailure))
    XCTAssertTrue(source.committed.isEmpty)
    XCTAssertEqual(source.remaining, 6)
    XCTAssertTrue(server.stored.isEmpty)
  }
}
