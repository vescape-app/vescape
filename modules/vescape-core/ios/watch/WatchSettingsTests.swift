import XCTest
@testable import VescapeCore

/// @parity /modules/vescape-core/android/src/test/java/expo/modules/vescapecore/watch/WatchSettingsTest.kt
/// @parity /watch/wearos/src/test/java/app/vescape/wear/WatchSettingsTest.kt
final class WatchSettingsTests: XCTestCase {
  func testTimeFormatRoundTripAndOlderPhoneDefault() {
    XCTAssertTrue(watchSourceSettingKeys.contains("timeFormat"))
    XCTAssertEqual(WatchSettings.decode([:]).timeFormat, "24h")
    XCTAssertEqual(WatchSettings.decode([WatchSettingsKey.timeFormat: "system"]).timeFormat, "24h")
    XCTAssertEqual(WatchSettings.decode(WatchSettings(timeFormat: "12h").payload).timeFormat, "12h")
  }

  func testTelemetryTrailIsEnabledForOlderPhonesAndFalseSurvivesSettingsReload() {
    XCTAssertEqual(AppDataRepository.defaultSettings["wearTelemetryTrailEnabled"] as? Bool, true)
    XCTAssertTrue(watchSourceSettingKeys.contains("wearTelemetryTrailEnabled"))
    XCTAssertTrue(WatchSettings.decode([:]).telemetryTrailEnabled)
    XCTAssertTrue(WatchSettings.decode([WatchSettingsKey.telemetryTrailEnabled: "false"]).telemetryTrailEnabled)
    let disabled = WatchSettings(telemetryTrailEnabled: false)
    XCTAssertEqual(WatchSettings.decode(disabled.payload), disabled)
    XCTAssertEqual(WatchSettings.decode(context: [watchSettingsChannel: disabled.payload]), disabled)
    XCTAssertTrue(WatchSettings.decode(WatchSettings().payload).telemetryTrailEnabled)
  }

  func testStreetMapIsEnabledForOlderPhonesAndFalseSurvivesSettingsReload() {
    XCTAssertEqual(AppDataRepository.defaultSettings["wearStreetMapEnabled"] as? Bool, true)
    XCTAssertTrue(watchSourceSettingKeys.contains("wearStreetMapEnabled"))
    XCTAssertTrue(WatchSettings.decode([:]).streetMapEnabled)
    let disabled = WatchSettings(streetMapEnabled: false)
    XCTAssertEqual(WatchSettings.decode(context: [watchSettingsChannel: disabled.payload]), disabled)
  }

  func testTelemetryGroupIsEnabledForOlderPhonesAndFalseSurvivesSettingsReload() {
    XCTAssertEqual(AppDataRepository.defaultSettings["wearTelemetryGroupEnabled"] as? Bool, true)
    XCTAssertTrue(watchSourceSettingKeys.contains("wearTelemetryGroupEnabled"))
    XCTAssertTrue(WatchSettings.decode([:]).telemetryGroupEnabled)
    XCTAssertTrue(WatchSettings.decode([WatchSettingsKey.telemetryGroupEnabled: "false"]).telemetryGroupEnabled)
    let disabled = WatchSettings(telemetryGroupEnabled: false)
    XCTAssertEqual(WatchSettings.decode(context: [watchSettingsChannel: disabled.payload]), disabled)
  }

  func testTelemetryRouteIsEnabledForOlderPhonesAndFalseSurvivesSettingsReload() {
    XCTAssertEqual(AppDataRepository.defaultSettings["wearTelemetryRouteEnabled"] as? Bool, true)
    XCTAssertTrue(watchSourceSettingKeys.contains("wearTelemetryRouteEnabled"))
    XCTAssertTrue(WatchSettings.decode([:]).telemetryRouteEnabled)
    XCTAssertTrue(WatchSettings.decode([WatchSettingsKey.telemetryRouteEnabled: "false"]).telemetryRouteEnabled)
    let disabled = WatchSettings(telemetryRouteEnabled: false)
    XCTAssertEqual(WatchSettings.decode(context: [watchSettingsChannel: disabled.payload]), disabled)
  }

  func testMapBehindGaugesKeepsItsStepAndFallsBackToTheDefault() {
    XCTAssertEqual(AppDataRepository.defaultSettings["wearMapGaugesPercent"] as? Int, 60)
    XCTAssertTrue(watchSourceSettingKeys.contains("wearMapGaugesPercent"))
    XCTAssertEqual(WatchSettings.decode([:]).mapGaugesPercent, 60)
    for invalid: Any in [50, 15, 100, -30, 75.5, "90", true, NSNull()] {
      XCTAssertEqual(WatchSettings.decode([WatchSettingsKey.mapGaugesPercent: invalid]).mapGaugesPercent, 60)
      XCTAssertNil(WatchMapGauges.percent(invalid))
    }
    XCTAssertEqual(WatchMapGauges.percent(45.0), 45)
    XCTAssertEqual(WatchMapGauges.percent(0), 0)
    let chosen = WatchSettings(mapGaugesPercent: 30)
    XCTAssertEqual(WatchSettings.decode(context: [watchSettingsChannel: chosen.payload]), chosen)
  }

  func testUnitPreferenceDefaultsAndRoundTripsAfterRestart() {
    for invalid: Any in ["unknown", 1, true, NSNull()] {
      XCTAssertEqual(WatchSettings.decode([WatchSettingsKey.distanceUnit: invalid]).distanceUnit, "km")
    }
    XCTAssertEqual(WatchSettings.decode([:]).distanceUnit, "km")
    let miles = WatchSettings(distanceUnit: "mi")
    XCTAssertEqual(WatchSettings.decode(miles.payload), miles)
    XCTAssertEqual(WatchSettings.decode(context: [watchSettingsChannel: miles.payload]), miles)
    XCTAssertEqual(WatchSettings.decode(WatchSettings(distanceUnit: "km").payload).distanceUnit, "km")
  }

  func testTemperatureUnitDefaultsAndRoundTripsAfterRestart() {
    XCTAssertTrue(watchSourceSettingKeys.contains("temperatureUnit"))
    for invalid: Any in ["kelvin", 1, true, NSNull()] {
      XCTAssertEqual(WatchSettings.decode([WatchSettingsKey.temperatureUnit: invalid]).temperatureUnit, "celsius")
    }
    XCTAssertEqual(WatchSettings.decode([:]).temperatureUnit, "celsius")
    let fahrenheit = WatchSettings(temperatureUnit: "fahrenheit")
    XCTAssertEqual(WatchSettings.decode(fahrenheit.payload), fahrenheit)
    XCTAssertEqual(WatchSettings.decode(context: [watchSettingsChannel: fahrenheit.payload]), fahrenheit)
  }

  func testMissingKeysFallBackToTheWristDefaults() {
    let decoded = WatchSettings.decode([:])
    XCTAssertNil(decoded.boardMoveStrengthPercent)
    XCTAssertFalse(decoded.navArrowEnabled)
  }

  func testTiltRateDefaultsUntilAPhoneSendsItAndIsHeldToASaneRange() {
    XCTAssertEqual(WatchSettings.decode([:]).tiltRatePercent, watchDefaultTiltRatePercent)
    XCTAssertEqual(WatchSettings.decode([WatchSettingsKey.tiltRatePercent: 30]).tiltRatePercent, 30)
    XCTAssertEqual(WatchSettings.decode([WatchSettingsKey.tiltRatePercent: 5000]).tiltRatePercent, 100)
    XCTAssertEqual(WatchSettings.decode([WatchSettingsKey.tiltRatePercent: "fast"]).tiltRatePercent, watchDefaultTiltRatePercent)
    XCTAssertEqual(WatchSettings.decode(WatchSettings(tiltRatePercent: 35).payload).tiltRatePercent, 35)
  }

  func testAbsentChannelIsTheWristDefaults() {
    XCTAssertEqual(WatchSettings.decode(context: ["route": ["points": 3]]), .wristDefaults)
  }

  func testAbsentStrengthIsNilRatherThanZeroPercent() {
    XCTAssertNil(WatchSettings.decode([WatchSettingsKey.navArrowEnabled: true]).boardMoveStrengthPercent)
  }

  func testRoundTripsThroughThePayload() {
    let settings = WatchSettings(boardMoveStrengthPercent: 45, navArrowEnabled: true)
    XCTAssertEqual(WatchSettings.decode(settings.payload), settings)
  }
}
