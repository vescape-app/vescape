import XCTest

@testable import VescapeCore

/// The NDJSON framing contract, driven by `shared/fixtures/accessory-protocol/framing.json`. Chunks
/// arrive as bytes so the cases can split a line mid-UTF-8-character, which is exactly what a BLE
/// notification boundary does.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/accessory/AccessoryNdjsonFramerTest.kt
final class AccessoryNdjsonFramerTests: XCTestCase {
  func testEveryFramingCaseMatchesTheSharedFixture() throws {
    let fixture = try AccessoryFixtures.load("framing.json")
    let maxLineBytes = try XCTUnwrap(fixture["maxLineBytes"] as? Int)
    XCTAssertEqual(
      maxLineBytes, AccessoryProtocol.maxLineBytes,
      "framer default must be the documented protocol limit"
    )

    for entry in try XCTUnwrap(fixture["cases"] as? [[String: Any]]) {
      let name = try XCTUnwrap(entry["name"] as? String)
      let framer = AccessoryNdjsonFramer(maxLineBytes: maxLineBytes)
      var lines: [String] = []
      var failure: AccessoryFramingError?

      for hex in try XCTUnwrap(entry["chunksHex"] as? [String]) {
        let result = framer.feed(AccessoryFixtures.hexToBytes(hex))
        lines.append(contentsOf: result.lines)
        failure = failure ?? result.failure
        XCTAssertLessThanOrEqual(
          framer.bufferedBytes, maxLineBytes,
          "\(name): the buffer must never exceed the protocol line limit"
        )
      }

      XCTAssertEqual(lines, try XCTUnwrap(entry["lines"] as? [String]), name)
      XCTAssertEqual(failure?.rawValue, entry["failure"] as? String, "\(name): failure")
    }
  }

  func testAPeerThatNeverSendsALineFeedCostsAFixedBuffer() {
    let framer = AccessoryNdjsonFramer()
    // Ten times the limit, in chunks, with no LF anywhere: an unbounded accumulator would hold all
    // of it. The framer must give up at the limit and stay terminal.
    let chunk = [UInt8](repeating: UInt8(ascii: "x"), count: 1024)
    var failure: AccessoryFramingError?
    for _ in 0..<40 {
      failure = failure ?? framer.feed(chunk).failure
      XCTAssertLessThanOrEqual(framer.bufferedBytes, AccessoryProtocol.maxLineBytes)
    }
    XCTAssertEqual(failure, .oversized)
    XCTAssertTrue(framer.failed)
    XCTAssertEqual(framer.bufferedBytes, 0)
  }

  func testResetClearsAFailedStreamForTheNextSession() {
    let framer = AccessoryNdjsonFramer(maxLineBytes: 16)
    XCTAssertEqual(
      framer.feed([UInt8](repeating: UInt8(ascii: "x"), count: 32)).failure, .oversized)
    framer.reset()
    let result = framer.feed([UInt8]("{\"a\":1}\n".utf8))
    XCTAssertEqual(result.lines, ["{\"a\":1}"])
    XCTAssertNil(result.failure)
  }
}
