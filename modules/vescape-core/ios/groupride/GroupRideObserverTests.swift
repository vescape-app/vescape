import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/GroupRideObserverTest.kt
final class GroupRideObserverTests: XCTestCase {
  func testASignalGoesOutWithAFixInsideAPrivacyZoneWhilePresenceStaysSuppressed() throws {
    let fix = TelemetryLocationCapture(
      latitude: 52, longitude: 21, speedMps: nil, bearingDeg: nil, accuracyM: 5, altitudeM: nil,
      timestamp: 1_000, precise: true
    )
    var zones = PrivacyZoneReadState()

    XCTAssertNil(zones.presenceFix(fix))
    var context = zones.signalContext(fix, nowMs: 2_000)
    XCTAssertNotNil(RiderSignals.sendIntent(RiderSignalKind(rawValue: "down")!, context))

    try zones.reload {
      [PrivacyZoneEntity(id: "home", enabled: true, centerLatitudeE7: 520_000_000, centerLongitudeE7: 210_000_000, radiusMeters: 200)]
    }
    XCTAssertNil(zones.presenceFix(fix))
    context = zones.signalContext(fix, nowMs: 2_000)
    XCTAssertTrue(context.insidePrivacyZone)
    XCTAssertNotNil(RiderSignals.sendIntent(RiderSignalKind(rawValue: "down")!, context))

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

  private final class RelayHarness {
    let clock = TestScheduler()
    final class Gate: OnlineCapability {
      var onlineBlocked = false
      let appVersion = "1.0.0"
      var changed: (() -> Void)?
      func refresh() {}
      func addListener(_ listener: @escaping () -> Void) -> () -> Void {
        changed = listener
        return { self.changed = nil }
      }
    }
    final class Link: GroupRideSocket {
      let request: URLRequest
      var frames: [[String: Any]] = []
      var closed = false
      var receiver: ((Result<String?, Error>) -> Void)?
      init(_ request: URLRequest) { self.request = request }
      func open() {}
      func close() { closed = true }
      func ping() {}
      func sendText(_ text: String, completion: @escaping (Error?) -> Void) {
        frames.append(try! JSONSerialization.jsonObject(with: Data(text.utf8)) as! [String: Any])
        completion(nil)
      }
      func receiveText(_ completion: @escaping (Result<String?, Error>) -> Void) { receiver = completion }
      func message(_ text: String) { receiver?(.success(text)) }
      var types: [String] { frames.compactMap { $0["type"] as? String } }
    }
    let gate = Gate()
    var account: String? = "acc"
    var token: String? = "token"
    var links: [Link] = []
    var demand: [Bool] = []
    var events: [(String, [String: Any?])] = []
    lazy var observer: GroupRideObserver = GroupRideObserver(
      emit: { [unowned self] name, body in self.events.append((name, body)) }, online: gate, scheduler: clock,
      deviceCredential: { [unowned self] in
        guard let account = self.account, let token = self.token else { return nil }
        return DeviceCredential(serverUrl: "https://example.com", token: token, accountId: account)
      },
      onPublicRideDemandChanged: { [unowned self] in self.demand.append(self.observer.publicRideNeedsLink) },
      now: { [unowned self] in self.clock.currentTimeMs },
      makeSocket: { [unowned self] request in
        let link = Link(request)
        self.links.append(link)
        return link
      }
    )
    func ready(_ link: Link? = nil) {
      let link = link ?? links.last!
      observer.onOpen(link)
      link.message(#"{"type":"snapshot","features":["public-ride","missed-positions"]}"#)
    }
    func offlineBuffer() {
      observer.loadPublicRide(PublicRideSwitch(on: true, until: nil), accountId: "acc")
      observer.setBoardConnected(true)
      observer.start("wss://example.com/ws/group-rides")
      ready()
      observer.onClosed(links.last!, responseCode: nil)
      var presence = RiderPresence(lat: 52, lng: 21)
      presence.atMs = 10_000
      observer.pushPresence(presence)
      observer.setBoardConnected(false)
      XCTAssertTrue(observer.publicRideNeedsLink)
    }
  }

  func testCompletedBufferOwnsReconnectRetriesWithoutGPSAndReleasesDemandOnlyAfterAck() {
    let h = RelayHarness()
    h.offlineBuffer()
    let old = h.links.last!
    h.clock.advance(1_000)
    h.ready()
    XCTAssertEqual(h.links.last!.types, ["missed-positions"])
    XCTAssertEqual(h.links.last!.request.value(forHTTPHeaderField: "Authorization"), "Bearer token")
    let firstUpload = h.links.last!
    h.clock.advance(PublicRide.missedRetryMs)
    XCTAssertTrue(firstUpload.closed)
    XCTAssertTrue(h.observer.publicRideNeedsLink)
    h.clock.advance(1_000)
    h.ready()
    let retry = h.links.last!
    XCTAssertEqual(retry.types, ["missed-positions"])
    old.message(#"{"type":"missed-stored"}"#)
    firstUpload.message(#"{"type":"missed-stored"}"#)
    XCTAssertTrue(h.observer.publicRideNeedsLink)
    retry.message(#"{"type":"missed-stored"}"#)
    XCTAssertFalse(h.observer.publicRideNeedsLink)
    XCTAssertEqual(h.demand.last, false)
    let count = h.links.count
    h.clock.advance(PublicRide.missedRetryMs * 2)
    XCTAssertEqual(h.links.count, count)
    h.observer.stop()
  }

  func testPendingUploadRespectsOnlineBlocksAnonymousUpgradesAndAccountSwitches() {
    let h = RelayHarness()
    h.offlineBuffer()
    h.gate.onlineBlocked = true
    h.gate.changed?()
    h.clock.advance(30_000)
    XCTAssertEqual(h.links.count, 1)
    XCTAssertTrue(h.observer.publicRideNeedsLink)
    h.token = nil
    h.gate.onlineBlocked = false
    h.gate.changed?()
    h.ready()
    XCTAssertTrue(h.links.last!.frames.isEmpty)
    XCTAssertTrue(h.observer.publicRideNeedsLink)
    h.token = "restored-token"
    h.observer.setAccount("acc")
    h.clock.advance(1_000)
    h.ready()
    XCTAssertEqual(h.links.last!.types, ["missed-positions"])
    h.account = "other"
    h.token = "other-token"
    h.observer.setAccount("other")
    h.clock.advance(1_000)
    h.ready()
    XCTAssertTrue(h.links.last!.frames.isEmpty)
    XCTAssertFalse(h.observer.publicRideNeedsLink)
    h.observer.stop()
  }

  func testReplayEventAndResyncEmitCurrentStateOnlyWhileActive() {
    let h = RelayHarness()
    h.observer.replayEvent("onGroupRideConnection")
    h.observer.replayEvent("onPublicRideStatus")
    h.observer.resync()
    XCTAssertTrue(h.events.isEmpty)

    h.observer.start("wss://example.com/ws/group-rides")
    h.ready()
    h.events.removeAll()

    h.observer.replayEvent("onGroupRideConnection")
    XCTAssertEqual(h.events.map(\.0), ["onGroupRideConnection"])
    XCTAssertEqual(h.events.first?.1["state"] as? String, "connected")

    h.events.removeAll()
    h.observer.replayEvent("onPublicRideStatus")
    XCTAssertEqual(h.events.map(\.0), ["onPublicRideStatus"])
    XCTAssertEqual(h.events.first?.1["supported"] as? Bool, true)

    h.events.removeAll()
    h.observer.replayEvent("onGroupRideSignalAvailability")
    XCTAssertEqual(h.events.map(\.0), ["onGroupRideSignalAvailability"])

    h.events.removeAll()
    h.observer.replayEvent("onPublicRiders")
    XCTAssertEqual(h.events.map(\.0), ["onPublicRiders"])

    h.events.removeAll()
    h.observer.replayEvent("onPublicPins")
    XCTAssertEqual(h.events.map(\.0), ["onPublicPins"])

    h.events.removeAll()
    h.observer.resync()
    XCTAssertEqual(
      Set(h.events.map(\.0)),
      [
        "onGroupRideConnection",
        "onGroupRideSignalAvailability",
        "onPublicRideStatus",
        "onPublicRiders",
        "onPublicPins",
      ]
    )
    XCTAssertEqual(h.events.last { $0.0 == "onPublicRideStatus" }?.1["supported"] as? Bool, true)

    h.observer.stop()
    h.events.removeAll()
    h.observer.replayEvent("onPublicRideStatus")
    h.observer.resync()
    XCTAssertTrue(h.events.isEmpty)
  }

}
