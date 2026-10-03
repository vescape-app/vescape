import XCTest
@testable import VescapeCore

/// Group Ride Frame codec.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/watch/GroupRideFrameTest.kt
final class GroupRideFrameTests: XCTestCase {
  func testAFrameSurvivesTheRoundTrip() {
    let frame = GroupRideFrame(
      courseDeg: 45,
      spanM: 750,
      riders: [
        GroupRideFrameRider(id: "a-1", name: "Ola", colorArgb: 0xFF38_BDF8, eastM: 12.5, northM: -40.25, stale: false),
        GroupRideFrameRider(
          id: "b-2", name: "Żaneta", colorArgb: 0xFFF4_72B6, eastM: -300, northM: 800, stale: true,
          batteryPercent: 0, batteryLevel: .critical, heatLevel: .warning
        ),
        GroupRideFrameRider(id: "c-3", name: "Kuba", colorArgb: 0, eastM: 1, northM: 2, stale: false, batteryPercent: 100),
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

  /// `bytes` with the last `drop` bytes of every rider record cut, as an older encoder wrote them.
  private func withRecordsCut(_ bytes: Data, riders: Int, drop: Int) -> Data {
    let base = [UInt8](bytes)
    let header = 1 + 4 + 4 + 1
    var out = Array(base[0..<header])
    var at = header
    for _ in 0..<riders {
      let length = Int(base[at])
      out.append(UInt8(length - drop))
      out.append(contentsOf: base[(at + 1)...(at + length - drop)])
      at += 1 + length
    }
    return Data(out)
  }

  func testARecordFromAPhoneBeforeBatteryAndHeatDecodesAsNoBatteryAndNormalLevels() {
    let rider = GroupRideFrameRider(
      id: "a", name: "Ola", colorArgb: 0, eastM: 5, northM: 6, stale: false,
      batteryPercent: 12, batteryLevel: .warning, heatLevel: .critical
    )
    let bytes = GroupRideFrameCodec.encode(GroupRideFrame(courseDeg: 10, spanM: 600, riders: [rider]))

    let decoded = GroupRideFrameCodec.decode(withRecordsCut(bytes, riders: 1, drop: 3))

    var expected = rider
    expected.batteryPercent = nil
    expected.batteryLevel = .normal
    expected.heatLevel = .normal
    XCTAssertEqual(decoded?.riders, [expected])
  }

  func testAWristFromBeforeBatteryAndHeatReadsTheRecordsItKnowsAndSkipsTheRest() {
    let riders = [
      GroupRideFrameRider(id: "a", name: "Ola", colorArgb: 0, eastM: 5, northM: 6, stale: true, batteryPercent: 9, batteryLevel: .critical),
      GroupRideFrameRider(id: "b", name: "Kuba", colorArgb: 0, eastM: -7, northM: 8, stale: false, heatLevel: .warning),
    ]
    let bytes = [UInt8](GroupRideFrameCodec.encode(GroupRideFrame(courseDeg: 10, spanM: 600, riders: riders)))
    // The first release's decoder: fixed fields up to flags, then a jump to the record's end.
    var at = 1 + 4 + 4
    let count = Int(bytes[at])
    at += 1
    var read: [(id: String, stale: Bool)] = []
    for _ in 0..<count {
      let end = at + 1 + Int(bytes[at])
      let idLength = Int(bytes[at + 1])
      let id = String(decoding: bytes[(at + 2)..<(at + 2 + idLength)], as: UTF8.self)
      let nameAt = at + 2 + idLength
      let flagsAt = nameAt + 1 + Int(bytes[nameAt]) + 4 + 4 + 4
      read.append((id, bytes[flagsAt] & 1 != 0))
      at = end
    }

    XCTAssertEqual(read.map(\.id), ["a", "b"])
    XCTAssertEqual(read.map(\.stale), [true, false])
    XCTAssertEqual(at, bytes.count)
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
}
