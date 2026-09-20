import XCTest
@testable import VescapeCore

/// The settings contract both ends of the mirror compile against: what a missing key means, what a
/// cleared colour means, and that the wrist never invents a value the rider did not choose.
///
/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/watch/WatchSettingsTest.kt
/// @parity /watch/wearos/src/test/java/app/vescape/wear/WatchSettingsTest.kt
final class WatchSettingsTests: XCTestCase {
  func testUnitPreferenceDefaultsAndRoundTripsAfterRestart() {
    for invalid: Any in ["unknown", 1, true, NSNull()] {
      XCTAssertEqual(WatchSettings.decode([WatchSettingsKey.unitSystem: invalid]).unitSystem, "metric")
    }
    XCTAssertEqual(WatchSettings.decode([:]).unitSystem, "metric")
    let imperial = WatchSettings(unitSystem: "imperial")
    XCTAssertEqual(WatchSettings.decode(imperial.payload), imperial)
    XCTAssertEqual(WatchSettings.decode(context: [watchSettingsChannel: imperial.payload]), imperial)
    XCTAssertEqual(WatchSettings.decode(WatchSettings(unitSystem: "metric").payload).unitSystem, "metric")
  }

  func testMissingKeysFallBackToTheWristDefaults() {
    let decoded = WatchSettings.decode([:])
    XCTAssertNil(decoded.riderColor)
    XCTAssertNil(decoded.boardMoveStrengthPercent)
    XCTAssertFalse(decoded.navArrowEnabled)
  }

  func testAbsentChannelIsTheWristDefaults() {
    XCTAssertEqual(WatchSettings.decode(context: ["route": ["points": 3]]), .wristDefaults)
  }

  func testBlankColourReadsAsNoColourNotAsAnEmptyString() {
    XCTAssertNil(WatchSettings.decode([WatchSettingsKey.riderColor: "  "]).riderColor)
  }

  func testAbsentStrengthIsNilRatherThanZeroPercent() {
    // The trap the Wear OS reader documents: coercing an absent key reads as a rider choosing 0 %.
    XCTAssertNil(WatchSettings.decode([WatchSettingsKey.navArrowEnabled: true]).boardMoveStrengthPercent)
  }

  func testRoundTripsThroughThePayload() {
    let settings = WatchSettings(riderColor: "#FF8800", boardMoveStrengthPercent: 45, navArrowEnabled: true)
    XCTAssertEqual(WatchSettings.decode(settings.payload), settings)
  }

  func testClearedColourRidesAsBlankSoTheWristCanTellItApartFromAnOldPhone() {
    let payload = WatchSettings(riderColor: nil, boardMoveStrengthPercent: nil, navArrowEnabled: false).payload
    XCTAssertEqual(payload[WatchSettingsKey.riderColor] as? String, "")
    XCTAssertNil(payload[WatchSettingsKey.boardMoveStrengthPercent])
  }

  func testParsesBothColourFormsAndRejectsEverythingElse() {
    XCTAssertEqual(parseWatchRiderColor("#FF0000"), WatchRiderColor(red: 1, green: 0, blue: 0))
    // AARRGGBB: alpha is parsed and dropped, so the same colour arrives at the same components.
    XCTAssertEqual(parseWatchRiderColor("#80FF0000"), WatchRiderColor(red: 1, green: 0, blue: 0))
    XCTAssertEqual(parseWatchRiderColor("00FF00"), WatchRiderColor(red: 0, green: 1, blue: 0))
    XCTAssertNil(parseWatchRiderColor(nil))
    XCTAssertNil(parseWatchRiderColor(""))
    XCTAssertNil(parseWatchRiderColor("red"))
    XCTAssertNil(parseWatchRiderColor("#FFF"))
    XCTAssertNil(parseWatchRiderColor("#GGGGGG"))
  }
}

/// The wrist -> phone wire. Two bytes, read leniently.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchCommand.kt `WatchCommandDecoder`
final class WatchCommandTests: XCTestCase {
  func testRoundTripsEveryWakeLevel() {
    for level in [WatchMirrorWakeLevel.asleep, .active, .ambient] {
      XCTAssertEqual(WatchCommandCodec.decode(WatchCommandCodec.encode(.mirrorAwake(level))), .mirrorAwake(level))
    }
  }

  func testIgnoresShortBuffersUnknownKindsAndUnknownLevels() {
    XCTAssertNil(WatchCommandCodec.decode(Data([WatchCommandKind.mirrorAwake])))
    XCTAssertNil(WatchCommandCodec.decode(Data([99, 1])))
    XCTAssertNil(WatchCommandCodec.decode(Data([WatchCommandKind.mirrorAwake, 9])))
  }

  func testWakeLevelWireValuesMatchAndroid() {
    XCTAssertEqual(WatchMirrorWakeLevel.asleep.rawValue, 0)
    XCTAssertEqual(WatchMirrorWakeLevel.active.rawValue, 1)
    XCTAssertEqual(WatchMirrorWakeLevel.ambient.rawValue, 2)
    XCTAssertEqual(WatchCommandKind.mirrorAwake, 2)
  }
}
