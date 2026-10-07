import XCTest
@testable import VescapeCore

/// Issue #551: delivery order, the in-flight limit, sleep, drops and a watch reset, against a
/// scripted transport.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/watch/WatchMapTileSenderTest.kt
final class WatchMapTileSenderTests: XCTestCase {
  /// Takes posts from the sender's send tasks on any thread; the test runs them.
  private final class QueueScheduler: Scheduler, @unchecked Sendable {
    private final class Posted: Cancellable { func cancel() {} }
    private let lock = NSLock()
    private var blocks: [() -> Void] = []

    func post(_ block: @escaping () -> Void) -> Cancellable {
      lock.withLock { blocks.append(block) }
      return Posted()
    }

    func postDelayed(_ delayMs: Int64, _ block: @escaping () -> Void) -> Cancellable { post(block) }

    func drain() {
      while let next = lock.withLock({ blocks.isEmpty ? nil : blocks.removeFirst() }) { next() }
    }
  }

  private final class Transport: WatchMapTileTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var started: [WatchMapTile] = []
    private var waiting: [CheckedContinuation<Bool, Never>] = []
    var held: Set<WatchMapTile>
    var holds: [(wanted: [WatchMapTile], dropped: Set<WatchMapTile>)] = []
    var onWatchReset: (() -> Void)?
    var onLost: ((WatchMapTile) -> Void)?

    init(held: Set<WatchMapTile> = []) { self.held = held }

    var sends: [WatchMapTile] { lock.withLock { started } }
    var inFlight: Int { lock.withLock { waiting.count } }

    func delivered() -> Set<WatchMapTile>? { held }

    func hold(wanted: [WatchMapTile], dropped: Set<WatchMapTile>) { holds.append((wanted, dropped)) }

    func send(_ tile: WatchMapTile, jpeg: URL) async -> Bool {
      await withCheckedContinuation { continuation in
        lock.withLock {
          started.append(tile)
          waiting.append(continuation)
        }
      }
    }

    /// Lands every send in flight, oldest first.
    func finishAll(_ sent: Bool) {
      let done = lock.withLock {
        defer { waiting.removeAll() }
        return waiting
      }
      done.forEach { $0.resume(returning: sent) }
    }
  }

  private let scheduler = QueueScheduler()
  private var nowMs: Int64 = 0
  private let rider = WatchMapRider(
    position: WatchMapPosition(latitude: 51.13185, longitude: 16.98653), courseDeg: 90, speedMps: 5, spanM: nil,
    route: nil)

  private func sender(_ transport: Transport) -> WatchMapTileSender {
    WatchMapTileSender(
      scheduler: scheduler, nowMs: { [unowned self] in nowMs }, fetch: { _ in URL(fileURLWithPath: "tile.jpg") },
      transport: transport)
  }

  /// Runs posted work until `done` or the time is up, waiting for the send tasks to reach the
  /// transport. Whether `done` held.
  private func wait(upToMs timeoutMs: Double = 5_000, until done: () -> Bool) async -> Bool {
    let deadline = Date().addingTimeInterval(timeoutMs / 1_000)
    while Date() < deadline {
      scheduler.drain()
      if done() { return true }
      try? await Task.sleep(nanoseconds: 2_000_000)
    }
    scheduler.drain()
    return done()
  }

  private func settle(until done: () -> Bool) async {
    if await !wait(until: done) { XCTFail("sender did not settle") }
  }

  /// Lets the send tasks started so far reach the transport.
  private func quiet() async {
    _ = await wait(upToMs: 200) { false }
  }

  private func tick(_ sender: WatchMapTileSender, _ rider: WatchMapRider?) {
    sender.update(rider)
    scheduler.drain()
  }

  /// Lands the sends a batch at a time, until nothing more goes out. A batch is complete at the
  /// in-flight limit, or once no more of it arrives.
  private func finishEverySend(_ transport: Transport) async {
    while true {
      if await !wait(upToMs: 500, until: { transport.inFlight == WatchMapTileSender.maxSendsInFlight }),
        transport.inFlight == 0
      {
        return
      }
      transport.finishAll(true)
    }
  }

  func testSendsNearestFirstFourAtATimeAndOnlyWhatTheWristLacks() async {
    let ring = WatchMapTilePlan.needed(rider, zoom: 15)
    let transport = Transport(held: [ring[1]])
    let sender = sender(transport)
    tick(sender, rider)
    await settle { transport.inFlight == WatchMapTileSender.maxSendsInFlight }
    // Sends overlap, so they reach the transport in any order within the batch.
    XCTAssertEqual(Set(transport.sends), Set(ring.filter { $0 != ring[1] }.prefix(WatchMapTileSender.maxSendsInFlight)))
    transport.finishAll(true)
    await settle { transport.sends.count == ring.count - 1 }
    XCTAssertEqual(Set(transport.sends), Set(ring).subtracting([ring[1]]))
  }

  func testRingTilesGoOutBeforeRouteTiles() async {
    let route = WatchMapRoute(points: (0...30).map { WatchMapPosition(latitude: 51.13185, longitude: 16.98653 + Double($0) * 0.01) })
    let onRoute = WatchMapRider(
      position: rider.position, courseDeg: 90, speedMps: 5, spanM: nil,
      route: WatchMapRouteProgress(route: route, remainingM: route.lengthM))
    let ring = WatchMapTilePlan.needed(onRoute, zoom: 15)
    let transport = Transport()
    let sender = sender(transport)
    tick(sender, onRoute)
    // Each batch starts once the one before it lands, so batches go out in the order they were wanted.
    await finishEverySend(transport)
    let sent = transport.sends
    XCTAssertEqual(Set(sent.prefix(ring.count)), Set(ring))
    XCTAssertGreaterThan(sent.count, ring.count)
    XCTAssertEqual(sent.count, Set(sent).count)
  }

  func testNothingNewStartsWhileTheWristSleeps() async {
    let transport = Transport()
    let sender = sender(transport)
    tick(sender, rider)
    await settle { transport.inFlight == WatchMapTileSender.maxSendsInFlight }
    tick(sender, nil)
    transport.finishAll(true)
    await quiet()
    XCTAssertEqual(transport.sends.count, WatchMapTileSender.maxSendsInFlight)
    tick(sender, rider)  // Waking re-reads the wrist, then resumes.
    await settle { transport.sends.count > WatchMapTileSender.maxSendsInFlight }
  }

  func testTilesLeavingThePlanAreDroppedFromTheWrist() {
    let z15 = Set(WatchMapTilePlan.ring(rider, zoom: 15))
    let stray = WatchMapTile(z: 15, x: 0, y: 0)
    let transport = Transport(held: z15.union([stray]))
    let sender = sender(transport)
    tick(sender, rider)
    // Left over from an earlier session.
    XCTAssertEqual(transport.holds.first?.dropped, [stray])
    // Zooming in keeps z15 as the one-out level.
    tick(sender, WatchMapRider(position: rider.position, courseDeg: 90, speedMps: 5, spanM: 300, route: nil))
    XCTAssertEqual(transport.holds.last?.dropped, [])
    // Two levels out, z15 is neither planned nor the level just left, so every z15 tile leaves.
    tick(sender, WatchMapRider(position: rider.position, courseDeg: 90, speedMps: 5, spanM: 1_400, route: nil))
    XCTAssertEqual(transport.holds.last?.dropped, z15)
    XCTAssertFalse(transport.holds.last?.wanted.contains { $0.z == 15 } ?? true)
  }

  func testAWatchResetMidSendFreesTheInFlightSlots() async {
    let transport = Transport()
    let sender = sender(transport)
    tick(sender, rider)
    await settle { transport.inFlight == WatchMapTileSender.maxSendsInFlight }
    let first = transport.sends
    // A reinstall drops the outstanding transfers; the pusher fails their sends.
    transport.onWatchReset?()
    transport.finishAll(false)
    await quiet()
    tick(sender, rider)
    await settle { transport.inFlight == WatchMapTileSender.maxSendsInFlight }
    // The failed tiles wait out their retry; the next ones go out instead of the sender stalling.
    XCTAssertTrue(Set(transport.sends.dropFirst(first.count)).isDisjoint(with: first))
    nowMs += WatchMapTileSender.retryMs
    transport.finishAll(true)
    await settle { transport.sends.count > 2 * first.count }
    XCTAssertTrue(Set(transport.sends.dropFirst(2 * first.count)).isSubset(of: Set(first)))
  }

  func testAFailedTransferAnEarlierProcessQueuedIsSentAgainAfterTheRetryWait() async {
    let ring = WatchMapTilePlan.needed(rider, zoom: 15)
    // Counted delivered: still queued by an earlier process.
    let transport = Transport(held: [ring[0]])
    let sender = sender(transport)
    tick(sender, rider)
    await settle { transport.inFlight == WatchMapTileSender.maxSendsInFlight }
    transport.onLost?(ring[0])
    await finishEverySend(transport)
    XCTAssertFalse(transport.sends.contains(ring[0]))
    nowMs += WatchMapTileSender.retryMs
    tick(sender, rider)
    await settle { transport.sends.contains(ring[0]) }
  }
}
