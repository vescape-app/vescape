import XCTest
@testable import VescapeCore

/// Ride Notice Frame codec and the phone's wrist slice.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/watch/RideNoticeFrameTest.kt
final class RideNoticeFrameTests: XCTestCase {
  private let frame = RideNoticeFrame(
    sentAtMs: 1_700_000_000_123,
    notices: [
      RideNoticeFrameItem(
        id: 7, rev: 2, severity: .critical, title: "Rider down", details: "Ola · 300 m behind",
        expiresAtMs: 1_700_000_600_000
      ),
      RideNoticeFrameItem(id: 255, rev: 255, severity: .info, title: "Regroup", details: "", expiresAtMs: nil),
    ]
  )

  func testAFrameSurvivesTheRoundTrip() {
    XCTAssertEqual(RideNoticeFrameCodec.decode(RideNoticeFrameCodec.encode(frame)), frame)
  }

  func testLongTextIsCutOnACharacterBoundary() {
    let long = RideNoticeFrameItem(
      id: 1, rev: 1, severity: .warning, title: String(repeating: "Ż", count: 80),
      details: String(repeating: "Ż", count: 400), expiresAtMs: nil
    )

    let decoded = RideNoticeFrameCodec.decode(RideNoticeFrameCodec.encode(RideNoticeFrame(sentAtMs: 0, notices: [long])))

    XCTAssertEqual(decoded?.notices.first?.title, String(repeating: "Ż", count: 48))
    XCTAssertEqual(decoded?.notices.first?.details, String(repeating: "Ż", count: 256))
  }

  func testADifferentWireVersionIsIgnoredWhole() {
    var bytes = [UInt8](RideNoticeFrameCodec.encode(frame))
    bytes[0] = UInt8(WATCH_RIDE_NOTICES_VERSION + 1)

    XCTAssertNil(RideNoticeFrameCodec.decode(Data(bytes)))
  }

  func testFieldsANewerPhoneAppendsToANoticeRecordAreSkipped() {
    let base = [UInt8](RideNoticeFrameCodec.encode(frame))
    let header = 1 + 8 + 1
    var out = Array(base[0..<header])
    var at = header
    for _ in frame.notices {
      let length = Int(base[at]) | Int(base[at + 1]) << 8
      out.append(UInt8((length + 2) & 0xFF))
      out.append(UInt8((length + 2) >> 8))
      out.append(contentsOf: base[(at + 2)..<(at + 2 + length)])
      out.append(contentsOf: [7, 9])
      at += 2 + length
    }

    XCTAssertEqual(RideNoticeFrameCodec.decode(Data(out)), frame)
  }

  func testAnUnknownSeverityReadsAsAWarning() {
    var bytes = [UInt8](RideNoticeFrameCodec.encode(frame))
    // version, sentAt, count, recordBytes, id, rev -> severity of the first notice.
    bytes[1 + 8 + 1 + 2 + 1 + 1] = 9

    XCTAssertEqual(RideNoticeFrameCodec.decode(Data(bytes))?.notices.first?.severity, .warning)
  }

  func testATruncatedPayloadIsRejected() {
    let bytes = RideNoticeFrameCodec.encode(frame)

    XCTAssertNil(RideNoticeFrameCodec.decode(bytes.prefix(bytes.count - 3)))
  }

  func testTheWristSliceKeepsIdentitySeverityTextAndExpiry() {
    let notice = RideNotice(
      id: 3, rev: 4, key: "group:rider-down:ola",
      content: RideNoticeContent(severity: .warning, title: "Low battery", details: "Kuba · 12%", postedAt: 5, expiresAt: 99)
    )

    XCTAssertEqual(
      rideNoticeFrame([notice], sentAtMs: 42),
      RideNoticeFrame(
        sentAtMs: 42,
        notices: [RideNoticeFrameItem(id: 3, rev: 4, severity: .warning, title: "Low battery", details: "Kuba · 12%", expiresAtMs: 99)]
      )
    )
  }
}
