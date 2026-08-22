import XCTest
@testable import VescapeCore

/// The engine against a fake transport: the cases that decide whether a Rider's data survives — a
/// wedged batch, a failure part-way through a drain, a dead token, and a response that outlived the
/// Account it was sent for.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/sync/SyncEngineTest.kt
final class SyncEngineTests: XCTestCase {
  /// Two rows per scan, so a backlog of four takes two passes — the shape these cases were written
  /// against.
  private func FakeSource(rows: Int) -> FakeSyncSource {
    let source = FakeSyncSource(rows: rows)
    source.scanLimit = 2
    return source
  }

  private func accepted(boards: Int) -> String {
    let counts = SyncTable.allCases
      .map { "\"\($0.wire)\":\($0 == .boards ? boards : 0)" }
      .joined(separator: ",")
    return "{\"accepted\":{\(counts)}}"
  }

  private func environment() -> SyncEnvironment {
    SyncEnvironment(
      ridingSamples: false,
      enabled: true,
      online: true,
      wifiOnly: false,
      onWifi: false,
      credentialReady: true,
      onlineBlocked: false
    )
  }

  private func engine(
    _ source: SyncSource,
    _ responses: [SyncResponse],
    sent: Sent = Sent()
  ) -> SyncEngine {
    var queue = responses
    return SyncEngine(
      source: source,
      transport: { body in
        sent.bodies.append(body)
        return queue.isEmpty ? .transient(reason: "no response queued") : queue.removeFirst()
      },
      environment: environment,
      clock: { 1_000 }
    )
  }

  final class Sent {
    var bodies: [String] = []
  }

  func testAValid200AdvancesOnlyTheRowsItAccountedFor() async {
    let source = FakeSource(rows: 2)
    let engine = engine(source, [.accepted(body: accepted(boards: 2))])

    let pass = await engine.runOnce()
    XCTAssertEqual(pass, .sent(rowCount: 2, morePending: false))
    XCTAssertEqual(source.committed, [[.boards: 2]])
  }

  func testAMismatchedAcceptedCountIsAProtocolFailureAndMovesNoCursor() async {
    let source = FakeSource(rows: 2)
    let engine = engine(source, [.accepted(body: accepted(boards: 1))])

    let pass = await engine.runOnce()
    XCTAssertEqual(pass, .paused(.protocolFailure))
    XCTAssertTrue(source.committed.isEmpty)
    XCTAssertEqual(source.failures.first?.1, "acceptedMismatch")
  }

  func testAMalformedSuccessBodyNeverAdvancesACursor() async {
    let source = FakeSource(rows: 2)
    let engine = engine(source, [.accepted(body: "not json")])

    let pass = await engine.runOnce()
    XCTAssertEqual(pass, .paused(.protocolFailure))
    XCTAssertTrue(source.committed.isEmpty)
  }

  func testARefusedBatchLeavesEveryCursorUntouchedAndDoesNotRetryOnAKick() async {
    let source = FakeSource(rows: 2)
    let sent = Sent()
    let engine = engine(source, [.invalid(status: 409, error: "dependency-conflict")], sent: sent)

    let first = await engine.runOnce()
    XCTAssertEqual(first, .paused(.protocolFailure))
    let onKick = await engine.runOnce()
    XCTAssertEqual(onKick, .paused(.protocolFailure))
    XCTAssertTrue(source.committed.isEmpty)
    // The paused engine never reached the transport a second time.
    XCTAssertEqual(sent.bodies.count, 1)
  }

  func testAFailurePartWayThroughADrainLeavesCursorsAtTheLastAcceptedBatch() async {
    let source = FakeSource(rows: 4)
    let engine = engine(
      source,
      [.accepted(body: accepted(boards: 2)), .transient(reason: "5xx")]
    )

    let pass = await engine.runOnce()
    XCTAssertEqual(pass, .sent(rowCount: 2, morePending: true))
    let second = await engine.runOnce()
    if case .waiting = second {} else { XCTFail("expected a backoff wait") }
    XCTAssertEqual(source.committed, [[.boards: 2]])
  }

  func testADeadTokenStopsTheLoopForSignIn() async {
    let source = FakeSource(rows: 2)
    let engine = engine(source, [.unauthorized])

    let pass = await engine.runOnce()
    XCTAssertEqual(pass, .paused(.authentication))
    XCTAssertEqual(engine.pauseReason, .authentication)
    XCTAssertTrue(source.committed.isEmpty)
  }

  func testAResponseFromThePreviousAccountCannotAdvanceACursor() async {
    let source = FakeSource(rows: 2)
    let engine = SyncEngine(
      source: source,
      transport: { _ in
        // The Account changed while this request was in flight.
        source.currentGeneration += 1
        return .accepted(body: self.accepted(boards: 2))
      },
      environment: environment,
      clock: { 1_000 }
    )

    let pass = await engine.runOnce()
    XCTAssertEqual(pass, .idle)
    XCTAssertTrue(source.committed.isEmpty)
  }

  func testATimeoutAfterTheServerCommittedResendsTheIdenticalBatch() async {
    let source = FakeSource(rows: 2)
    let sent = Sent()
    let engine = engine(
      source,
      [.transient(reason: "timeout"), .accepted(body: accepted(boards: 2))],
      sent: sent
    )

    _ = await engine.runOnce()
    engine.resume()
    _ = await engine.runOnce()
    XCTAssertEqual(sent.bodies.count, 2)
    XCTAssertEqual(sent.bodies.first, sent.bodies.last)
  }

  func test413PausesOnASingleRowRatherThanSkippingIt() async {
    let source = FakeSource(rows: 1)
    let engine = engine(source, [.tooLarge])

    let pass = await engine.runOnce()
    XCTAssertEqual(pass, .paused(.rowTooLarge))
    XCTAssertTrue(source.committed.isEmpty)
    XCTAssertEqual(source.remaining, 1)
  }

  /// A shrink accepted nothing, so it must not be reported as an upload.
  func test413OnAMultiRowBatchNarrowsTheTargetAndRetries() async {
    let source = FakeSource(rows: 4)
    let engine = engine(source, [.tooLarge])

    let pass = await engine.runOnce()
    XCTAssertEqual(pass, .retry)
    XCTAssertTrue(source.committed.isEmpty)
    XCTAssertEqual(source.remaining, 4)
  }

  /// Halving forever against a server that keeps refusing would be an unbounded request storm.
  func test413AtTheSmallestBatchPausesInsteadOfResendingForever() async {
    let source = FakeSource(rows: 4)
    let engine = engine(source, Array(repeating: SyncResponse.tooLarge, count: 10))

    var outcome = await engine.runOnce()
    var passes = 0
    while outcome == .retry, passes < 10 {
      outcome = await engine.runOnce()
      passes += 1
    }
    XCTAssertEqual(outcome, .paused(.rowTooLarge))
    XCTAssertTrue(source.committed.isEmpty)
  }

  /// The server took the rows; the checkpoint did not land. Resending is safe, claiming success is not.
  func testAFailedCursorCommitBacksOffInsteadOfReportingAnUpload() async {
    let source = FakeSource(rows: 2)
    source.commitFailure = SyncStoreError.databaseUnavailable
    let engine = engine(source, [.accepted(body: accepted(boards: 2))])

    let outcome = await engine.runOnce()
    if case .waiting = outcome {} else { XCTFail("expected a backoff wait") }
    XCTAssertTrue(source.committed.isEmpty)
    XCTAssertEqual(source.remaining, 2)
  }

  func test429WaitsForTheServersOwnDelay() async {
    let source = FakeSource(rows: 2)
    let engine = engine(source, [.rateLimited(retryAfterMs: 90_000)])

    let pass = await engine.runOnce()
    XCTAssertEqual(pass, .waiting(untilMs: 91_000))
    XCTAssertNil(engine.pauseReason)
  }

  func testARowThatCannotBeEncodedPausesWithTheRowRetained() async {
    let source = FakeSource(rows: 2)
    source.encodeFailure = SyncProtocolError(table: .boards, field: "id", problem: "must not be empty")
    let engine = engine(source, [])

    let pass = await engine.runOnce()
    XCTAssertEqual(pass, .paused(.protocolFailure))
    XCTAssertEqual(source.failures.first?.1, "boards.id")
    XCTAssertEqual(source.remaining, 2)
  }
}
