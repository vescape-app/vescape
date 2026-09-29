import XCTest
@testable import VescapeCore

/// Group Ride Frame builder, codec and push gating.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/watch/GroupRideFrameTest.kt
final class GroupRideFrameTests: XCTestCase {
  private let me = WatchGeoPoint(latitude: 52.0, longitude: 21.0)
  private let nowMs: Int64 = 1_000_000

  private func rider(
    _ id: String,
    at position: WatchGeoPoint? = WatchGeoPoint(latitude: 52.001, longitude: 21.0),
    color: String? = "#FF0000",
    stale: Bool = false,
    lastSeenMs: Int64? = nil
  ) -> GroupRideRosterRider {
    GroupRideRosterRider(
      id: id, name: id.uppercased(), color: color, position: position, stale: stale,
      lastSeenMs: lastSeenMs ?? nowMs
    )
  }

  private func build(
    _ riders: [GroupRideRosterRider],
    own: WatchGeoPoint?? = .none,
    spanM: Double? = 800
  ) -> GroupRideFrame {
    GroupRideFrameBuilder.build(
      roster: GroupRideRoster(ownRiderId: "me", riders: riders),
      own: own ?? me,
      courseDeg: 90,
      spanM: spanM,
      nowMs: nowMs
    )
  }

  // MARK: - Builder

  func testOtherRidersBecomeOffsetsFromTheRidersFixNearestFirst() {
    let frame = build([
      rider("far", at: WatchGeoPoint(latitude: 52.0, longitude: 21.01)),
      rider("near", at: WatchGeoPoint(latitude: 52.001, longitude: 21.0)),
    ])

    XCTAssertEqual(frame.riders.map(\.id), ["near", "far"])
    XCTAssertEqual(frame.riders[0].eastM, 0, accuracy: 0.01)
    XCTAssertEqual(frame.riders[0].northM, 110.574, accuracy: 0.01)
    XCTAssertEqual(frame.riders[1].eastM, 685, accuracy: 1)
    XCTAssertEqual(frame.courseDeg, 90)
  }

  func testTheRidersOwnEntryIsNeverInTheFrame() {
    XCTAssertEqual(build([rider("me"), rider("ola")]).riders.map(\.id), ["ola"])
  }

  func testSpanFallsBackTo600MetresUntilThePhoneMapPublishesOne() {
    XCTAssertEqual(build([], spanM: nil).spanM, 600)
    XCTAssertEqual(build([], spanM: 0).spanM, 600)
    XCTAssertEqual(build([], spanM: 800).spanM, 800)
  }

  func testWithoutAFixNobodyCanBePlaced() {
    XCTAssertTrue(build([rider("ola")], own: .some(nil)).riders.isEmpty)
  }

  func testRidersWithoutPositionOrSilentPastTheDropWindowAreLeftOut() {
    let frame = build([
      rider("nowhere", at: nil),
      rider("gone", lastSeenMs: nowMs - GROUP_RIDE_DROP_AFTER_MS),
      rider("ola"),
    ])

    XCTAssertEqual(frame.riders.map(\.id), ["ola"])
  }

  func testARiderUnheardPastTheStaleWindowIsStale() {
    let frame = build([
      rider("quiet", lastSeenMs: nowMs - GROUP_RIDE_STALE_AFTER_MS),
      rider("flagged", at: WatchGeoPoint(latitude: 52.002, longitude: 21.0), stale: true),
    ])

    XCTAssertTrue(frame.riders.allSatisfy(\.stale))
  }

  func testAChosenColourIsKeptAndAMissingOneFallsBackByRosterPosition() {
    let frame = build([
      rider("picked", at: WatchGeoPoint(latitude: 52.001, longitude: 21.0), color: "#10C69A"),
      rider("unpicked", at: WatchGeoPoint(latitude: 52.002, longitude: 21.0), color: nil),
    ])

    XCTAssertEqual(frame.riders[0].colorArgb, 0xFF10_C69A)
    XCTAssertEqual(frame.riders[1].colorArgb, 0xFF22_C55E)
  }

  func testFallbackColoursFollowThePhoneRosterOrderOwnRiderFirstThenNearest() {
    let frame = GroupRideFrameBuilder.build(
      roster: GroupRideRoster(ownRiderId: "me", riders: [
        rider("me", color: nil),
        rider("far", at: WatchGeoPoint(latitude: 52.002, longitude: 21.0), color: nil),
        rider("near", at: WatchGeoPoint(latitude: 52.001, longitude: 21.0), color: nil),
      ]),
      own: me, courseDeg: nil, spanM: nil, nowMs: nowMs
    )

    // Index 0 is the Rider's own entry; near is 1 (green), far is 2 (amber).
    XCTAssertEqual(frame.riders.map(\.colorArgb), [0xFF22_C55E, 0xFFF5_9E0B])
  }

  // MARK: - Codec

  func testAFrameSurvivesTheRoundTrip() {
    let frame = GroupRideFrame(
      courseDeg: 45,
      spanM: 750,
      riders: [
        GroupRideFrameRider(id: "a-1", name: "Ola", colorArgb: 0xFF38_BDF8, eastM: 12.5, northM: -40.25, stale: false),
        GroupRideFrameRider(id: "b-2", name: "Żaneta", colorArgb: 0xFFF4_72B6, eastM: -300, northM: 800, stale: true),
      ]
    )

    XCTAssertEqual(GroupRideFrameCodec.decode(GroupRideFrameCodec.encode(frame)), frame)
  }

  func testNoCourseYetDecodesBackToNil() {
    let frame = GroupRideFrame(courseDeg: nil, spanM: 600, riders: [])

    XCTAssertNil(GroupRideFrameCodec.decode(GroupRideFrameCodec.encode(frame))?.courseDeg)
  }

  func testLongNamesAreCutOnACharacterBoundary() {
    let frame = GroupRideFrame(
      courseDeg: 0, spanM: 600,
      riders: [GroupRideFrameRider(id: "x", name: String(repeating: "Ż", count: 40), colorArgb: 0, eastM: 1, northM: 1, stale: false)]
    )

    let decoded = GroupRideFrameCodec.decode(GroupRideFrameCodec.encode(frame))

    XCTAssertEqual(decoded?.riders.first?.name, String(repeating: "Ż", count: 16))
  }

  func testADifferentWireVersionIsIgnoredWhole() {
    var bytes = GroupRideFrameCodec.encode(GroupRideFrame(courseDeg: 0, spanM: 600, riders: []))
    bytes[0] = UInt8(WATCH_GROUP_RIDE_VERSION + 1)

    XCTAssertNil(GroupRideFrameCodec.decode(bytes))
  }

  func testFieldsANewerPhoneAppendsToARiderRecordAreSkipped() {
    let rider = GroupRideFrameRider(id: "a", name: "Ola", colorArgb: 0xFF00_FF00, eastM: 5, northM: 6, stale: false)
    var second = rider
    second.id = "b"
    let base = [UInt8](GroupRideFrameCodec.encode(GroupRideFrame(courseDeg: 10, spanM: 600, riders: [rider, second])))
    // Rebuild with two extra bytes after each record, as a later version of the record would carry.
    let header = 1 + 4 + 4 + 1
    var out = Array(base[0..<header])
    var at = header
    for _ in 0..<2 {
      let length = Int(base[at])
      out.append(UInt8(length + 2))
      out.append(contentsOf: base[(at + 1)...(at + length)])
      out.append(contentsOf: [7, 9])
      at += 1 + length
    }

    XCTAssertEqual(GroupRideFrameCodec.decode(Data(out))?.riders, [rider, second])
  }

  func testATruncatedPayloadDecodesToNothing() {
    let bytes = GroupRideFrameCodec.encode(
      GroupRideFrame(
        courseDeg: 0, spanM: 600,
        riders: [GroupRideFrameRider(id: "a", name: "Ola", colorArgb: 0, eastM: 1, northM: 1, stale: false)]
      )
    )

    XCTAssertNil(GroupRideFrameCodec.decode(bytes.dropLast(3)))
    XCTAssertNil(GroupRideFrameCodec.decode(Data()))
  }

  // MARK: - Push gating

  private final class Gate {
    var present = true
    var wake: WatchMirrorWakeLevel = .active
    var joined = true

    init(present: Bool = true, wake: WatchMirrorWakeLevel = .active, joined: Bool = true) {
      self.present = present
      self.wake = wake
      self.joined = joined
    }
  }

  private func tick(_ scheduler: TestScheduler, _ gate: Gate, push: @escaping (Data) -> Void) -> GroupRideFrameTick {
    GroupRideFrameTick(
      scheduler: scheduler,
      canPushWatchFrame: { gate.present },
      wakeLevel: { gate.wake },
      frame: { gate.joined ? GroupRideFrame(courseDeg: 0, spanM: 600, riders: []) : nil },
      push: push
    )
  }

  func testPushesAboutOnceASecondWhileJoinedWithTheWristAwake() {
    let scheduler = TestScheduler()
    var pushed: [Data] = []
    let groupTick = tick(scheduler, Gate()) { pushed.append($0) }
    groupTick.start()

    scheduler.advance(3 * GROUP_RIDE_FRAME_INTERVAL_MS)

    XCTAssertEqual(pushed.count, 3)
    XCTAssertEqual(pushed.first?.first, UInt8(WATCH_GROUP_RIDE_VERSION))
  }

  func testPushesNothingWhenNotJoinedAsleepInAmbientOrUnreachable() {
    for gate in [Gate(joined: false), Gate(wake: .asleep), Gate(wake: .ambient), Gate(present: false)] {
      let scheduler = TestScheduler()
      var pushes = 0
      let groupTick = tick(scheduler, gate) { _ in pushes += 1 }
      groupTick.start()

      scheduler.advance(5 * GROUP_RIDE_FRAME_INTERVAL_MS)

      XCTAssertEqual(pushes, 0)
    }
  }

  func testTheTickResumesWhenTheGateLiftsAndStopsForGood() {
    let scheduler = TestScheduler()
    let gate = Gate(wake: .ambient)
    var pushes = 0
    let groupTick = tick(scheduler, gate) { _ in pushes += 1 }
    groupTick.start()

    scheduler.advance(2 * GROUP_RIDE_FRAME_INTERVAL_MS)
    gate.wake = .active
    scheduler.advance(GROUP_RIDE_FRAME_INTERVAL_MS)
    XCTAssertEqual(pushes, 1)

    groupTick.stop()
    scheduler.advance(5 * GROUP_RIDE_FRAME_INTERVAL_MS)
    XCTAssertEqual(pushes, 1)
  }
}
