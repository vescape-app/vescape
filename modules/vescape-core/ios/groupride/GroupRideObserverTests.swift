import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/GroupRideObserverTest.kt
final class GroupRideObserverTests: XCTestCase {
  private final class FakeSocket: GroupRideSocket {
    var sent: [[String: Any]] = []
    var deliver: ((Result<String?, Error>) -> Void)?
    func open() {}
    func sendText(_ text: String, completion: @escaping (Error?) -> Void) {
      sent.append((try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any] ?? [:])
    }
    func receiveText(_ completion: @escaping (Result<String?, Error>) -> Void) { deliver = completion }
    func ping() {}
    func close() {}
  }

  private final class Online: OnlineCapability {
    let onlineBlocked = false
    let appVersion = ""
    func refresh() {}
    func addListener(_ listener: @escaping () -> Void) -> () -> Void { {} }
  }

  private let online = Online()
  private var scheduler = TestScheduler()
  private var sockets: [FakeSocket] = []
  private var context = RiderSignalContext(fix: (lat: 52, lng: 21), insidePrivacyZone: false)
  private var observer: GroupRideObserver!

  override func setUp() {
    super.setUp()
    scheduler = TestScheduler()
    sockets = []
    context = RiderSignalContext(fix: (lat: 52, lng: 21), insidePrivacyZone: false)
    observer = GroupRideObserver(
      emit: { _, _ in },
      online: online,
      scheduler: scheduler,
      signalContext: { [unowned self] in self.context },
      makeSocket: { [unowned self] _ in
        let socket = FakeSocket()
        self.sockets.append(socket)
        return socket
      }
    )
  }

  override func tearDown() {
    observer.stop()
    observer = nil
    super.tearDown()
  }

  private func receive(_ frame: [String: Any]) throws {
    let data = try JSONSerialization.data(withJSONObject: frame)
    try XCTUnwrap(sockets.last?.deliver)(.success(String(decoding: data, as: UTF8.self)))
  }

  private func connect(features: [String]) throws {
    observer.onOpen(try XCTUnwrap(sockets.last))
    try receive(["type": "snapshot", "rides": [], "features": features])
  }

  private func joined() throws {
    try receive(["type": "joined", "rideId": "ride"])
  }

  private func joinRide(features: [String] = [RiderSignals.relayFeature]) throws {
    observer.start("ws://relay.test")
    try connect(features: features)
    observer.join(riderId: "me", riderName: "Me", rideId: "ride", presence: nil)
    try joined()
  }

  private func frames(_ type: String) -> [[String: Any]] {
    sockets.flatMap(\.sent).filter { $0["type"] as? String == type }
  }

  func testASendEmitsASignalFrameAtTheFix() throws {
    try joinRide()
    observer.sendSignal("help")

    let frame = try XCTUnwrap(frames("signal").first)
    XCTAssertEqual(frames("signal").count, 1)
    XCTAssertEqual(frame["kind"] as? String, "help")
    XCTAssertEqual(frame["lat"] as? Double, 52)
    XCTAssertEqual(frame["lng"] as? Double, 21)
  }

  func testAClearEmitsSignalClear() throws {
    try joinRide()
    observer.clearSignal()

    XCTAssertEqual(frames("signal-clear").count, 1)
  }

  func testARelayWithoutRiderSignalsIsSentNothing() throws {
    try joinRide(features: [])
    observer.sendSignal("help")
    observer.clearSignal()

    XCTAssertTrue(frames("signal").isEmpty)
    XCTAssertTrue(frames("signal-clear").isEmpty)
  }

  func testAnIntentMadeWhileTheLinkIsDownIsReplayedOnceAfterRejoin() throws {
    try joinRide()
    observer.onClosed(try XCTUnwrap(sockets.last), responseCode: nil)
    observer.sendSignal("wait")
    XCTAssertTrue(frames("signal").isEmpty)

    scheduler.advance(1_000)
    XCTAssertEqual(sockets.count, 2)
    try connect(features: [RiderSignals.relayFeature])
    XCTAssertTrue(frames("signal").isEmpty, "held until the ride is rejoined")
    try joined()
    try joined()

    XCTAssertEqual(frames("signal").map { $0["kind"] as? String }, ["wait"])
  }

  func testASignalGoesOutWithAFixInsideAPrivacyZoneWhilePresenceStaysSuppressed() throws {
    let fix = TelemetryLocationCapture(
      latitude: 52, longitude: 21, speedMps: nil, bearingDeg: nil, accuracyM: 5, altitudeM: nil,
      timestamp: 1_000, precise: true
    )
    var zones = PrivacyZoneReadState()
    try joinRide()

    // Zones still loading: presence is gated, a signal is not.
    XCTAssertNil(zones.presenceFix(fix))
    context = zones.signalContext(fix, nowMs: 2_000)
    observer.sendSignal("down")

    // Loaded, and the fix is inside one.
    try zones.reload {
      [PrivacyZoneEntity(id: "home", enabled: true, centerLatitudeE7: 520_000_000, centerLongitudeE7: 210_000_000, radiusMeters: 200)]
    }
    XCTAssertNil(zones.presenceFix(fix))
    context = zones.signalContext(fix, nowMs: 2_000)
    XCTAssertTrue(context.insidePrivacyZone)
    observer.sendSignal("help")

    XCTAssertEqual(frames("signal").map { $0["kind"] as? String }, ["down", "help"])
    XCTAssertTrue(frames("signal").allSatisfy { $0["lat"] as? Double == 52 && $0["lng"] as? Double == 21 })
    XCTAssertTrue(frames("presence").isEmpty)
    // The gate opens again outside every zone.
    let outside = TelemetryLocationCapture(
      latitude: 53, longitude: 21, speedMps: nil, bearingDeg: nil, accuracyM: 5, altitudeM: nil,
      timestamp: 1_000, precise: true
    )
    XCTAssertNotNil(zones.presenceFix(outside))
  }

  private func rider(presence: [String: Any]?) -> GroupRideRosterRider? {
    GroupRideObserver.rosterRider(["id": "ola", "presence": GroupRideObserver.presenceMap(presence)])
  }

  func testAPresenceWithBothCoordinatesPlacesTheRider() {
    let position = rider(presence: ["lat": 52.0, "lng": 21.0])?.position

    XCTAssertEqual(position?.latitude, 52.0)
    XCTAssertEqual(position?.longitude, 21.0)
  }

  func testAPresenceMissingACoordinateLeavesTheRiderUnplacedNotAtZeroZero() {
    XCTAssertNil(GroupRideObserver.presenceMap(["lat": 52.0, "soc": 80.0]))
    XCTAssertNil(rider(presence: ["lat": 52.0])?.position)
    XCTAssertNil(rider(presence: ["lng": 21.0])?.position)
    XCTAssertNotNil(rider(presence: ["lng": 21.0]))
  }

  func testNoPresenceLeavesTheRiderUnplaced() {
    XCTAssertNil(rider(presence: nil)?.position)
  }

  func testACreatedRideCuesForTheRidersOwnRideOrOneNearby() {
    let audible = GroupRideObserver.rideCreatedAudible
    XCTAssertTrue(audible("me", "me", 50.0, 20.0, nil))
    XCTAssertFalse(audible("ola", "me", 50.0, 20.0, nil))
    XCTAssertTrue(audible("ola", "me", 50.1, 20.0, (lat: 50.0, lng: 20.0)))
    XCTAssertFalse(audible("ola", "me", 51.0, 20.0, (lat: 50.0, lng: 20.0)))
    XCTAssertFalse(audible("", nil, 51.0, 20.0, nil))
  }
}
