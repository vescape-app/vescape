import XCTest
@testable import VescapeCore

final class AppDataRepositoryBoardLinkTests: XCTestCase {
  private func roundTrip(_ link: [String: Any?]) -> [String: Any?]? {
    let normalized = BoardLinkPersistence.normalized(link)
    let bleId = normalized?["bleId"] as? String
    let storedTransport = BoardTransport.encode(BoardTransport.fromBridge(normalized?["transport"] ?? nil))
    var values: [String: Any] = [:]
    for (key, value) in BoardLinkPersistence.settings(from: link) where key != "transport" {
      if let value { values[key] = value }
    }
    return BoardLinkPersistence.compose(bleId: bleId, storedTransport: storedTransport, values: values)
  }

  func testV3IdentityFieldsSurviveRoundTrip() {
    let link = roundTrip([
      "bleId": "AA:BB",
      "transport": "direct",
      "linkVersion": 4,
      "hasBms": true,
      "vescFirmwareVersion": "FW 6.05",
      "refloatVersion": "2.1.0",
      "refloatBaseVersion": "1.4.0",
      "futureField": "ignored",
    ])

    XCTAssertEqual(link?["bleId"] as? String, "AA:BB")
    XCTAssertEqual(link?["transport"] as? String, "direct")
    XCTAssertEqual(link?["linkVersion"] as? Int, 4)
    XCTAssertEqual(link?["hasBms"] as? Bool, true)
    XCTAssertEqual(link?["vescFirmwareVersion"] as? String, "FW 6.05")
    XCTAssertEqual(link?["refloatVersion"] as? String, "2.1.0")
    XCTAssertEqual(link?["refloatBaseVersion"] as? String, "1.4.0")
    XCTAssertNil(link?["futureField"] ?? nil)
  }

  func testHasBmsFalseSurvivesRoundTrip() {
    let link = roundTrip([
      "bleId": "AA:BB",
      "transport": 84,
      "linkVersion": 4,
      "hasBms": false,
      "vescFirmwareVersion": "FW 6.05",
      "refloatVersion": "2.1.0",
      "refloatBaseVersion": "1.4.0",
    ])

    XCTAssertEqual(link?["hasBms"] as? Bool, false)
  }

  func testLegacyBleIdAndTransportReadsAsTelemetryCapableLink() {
    let link = roundTrip([
      "bleId": "AA:BB",
      "transport": 84,
    ])

    XCTAssertNotNil(link)
    XCTAssertEqual(link?["bleId"] as? String, "AA:BB")
    XCTAssertEqual(link?["transport"] as? Int, 84)
    XCTAssertNil(link?["hasBms"] ?? nil)
  }

  func testMalformedLinkIsIgnored() {
    XCTAssertNil(roundTrip(["bleId": "", "transport": 84]))
    XCTAssertNil(roundTrip(["bleId": "AA:BB", "transport": 999]))
  }
}
