import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchSettings.kt
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchSettings.kt
enum WatchSettingsKey {
  static let boardMoveStrengthPercent = "boardMoveStrengthPercent"
  static let navArrowEnabled = "navArrowEnabled"
  static let telemetryTrailEnabled = "telemetryTrailEnabled"
  static let telemetryGroupEnabled = "telemetryGroupEnabled"
  static let telemetryRouteEnabled = "telemetryRouteEnabled"
  static let streetMapEnabled = "streetMapEnabled"
  static let mapGaugesPercent = "mapGaugesPercent"
  static let distanceUnit = "distanceUnit"
  static let temperatureUnit = "temperatureUnit"
  static let timeFormat = "timeFormat"
  static let tiltRatePercent = "tiltRatePercent"
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchSettings.kt `DEFAULT_TILT_RATE_PERCENT`
let watchDefaultTiltRatePercent = 20

let watchSettingsChannel = "settings"

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchSettings.kt `WatchSettings`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchSettings.kt `WATCH_SOURCE_SETTING_KEYS`
let watchSourceSettingKeys: Set<String> = [
  "boardMoveStrengthPercent",
  "wearNavArrowEnabled",
  "wearTelemetryTrailEnabled",
  "wearTelemetryGroupEnabled",
  "wearTelemetryRouteEnabled",
  "wearStreetMapEnabled",
  "wearMapGaugesPercent",
  "distanceUnit",
  "temperatureUnit",
  "timeFormat",
  "wearTiltRatePercent",
  "wearPushRateHz",
]

struct WatchSettings: Equatable {
  var boardMoveStrengthPercent: Int?
  var navArrowEnabled: Bool = false
  var telemetryTrailEnabled: Bool = true
  var telemetryGroupEnabled: Bool = true
  var telemetryRouteEnabled: Bool = true
  var streetMapEnabled: Bool = true
  var mapGaugesPercent: Int = WatchMapGauges.defaultPercent
  var distanceUnit: String = "km"
  var temperatureUnit: String = "celsius"
  var timeFormat: String = "24h"
  var tiltRatePercent: Int = watchDefaultTiltRatePercent

  static let wristDefaults = WatchSettings()

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchSettingsPusher.kt `push`
  var payload: [String: Any] {
    var payload: [String: Any] = [
      WatchSettingsKey.navArrowEnabled: navArrowEnabled,
      WatchSettingsKey.telemetryTrailEnabled: telemetryTrailEnabled,
      WatchSettingsKey.telemetryGroupEnabled: telemetryGroupEnabled,
      WatchSettingsKey.telemetryRouteEnabled: telemetryRouteEnabled,
      WatchSettingsKey.streetMapEnabled: streetMapEnabled,
      WatchSettingsKey.mapGaugesPercent: mapGaugesPercent,
      WatchSettingsKey.distanceUnit: distanceUnit,
      WatchSettingsKey.temperatureUnit: temperatureUnit,
      WatchSettingsKey.timeFormat: timeFormat,
      WatchSettingsKey.tiltRatePercent: tiltRatePercent,
    ]
    if let boardMoveStrengthPercent { payload[WatchSettingsKey.boardMoveStrengthPercent] = boardMoveStrengthPercent }
    return payload
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchSettings.kt `decode`
  static func decode(_ payload: [String: Any]?) -> WatchSettings {
    guard let payload else { return wristDefaults }
    return WatchSettings(
      boardMoveStrengthPercent: (payload[WatchSettingsKey.boardMoveStrengthPercent] as? NSNumber)?.intValue,
      navArrowEnabled: payload[WatchSettingsKey.navArrowEnabled] as? Bool ?? wristDefaults.navArrowEnabled,
      telemetryTrailEnabled: payload[WatchSettingsKey.telemetryTrailEnabled] as? Bool ?? wristDefaults.telemetryTrailEnabled,
      telemetryGroupEnabled: payload[WatchSettingsKey.telemetryGroupEnabled] as? Bool ?? wristDefaults.telemetryGroupEnabled,
      telemetryRouteEnabled: payload[WatchSettingsKey.telemetryRouteEnabled] as? Bool ?? wristDefaults.telemetryRouteEnabled,
      streetMapEnabled: payload[WatchSettingsKey.streetMapEnabled] as? Bool ?? wristDefaults.streetMapEnabled,
      mapGaugesPercent: WatchMapGauges.percent(payload[WatchSettingsKey.mapGaugesPercent]) ?? wristDefaults.mapGaugesPercent,
      distanceUnit: payload[WatchSettingsKey.distanceUnit] as? String == "mi" ? "mi" : "km",
      temperatureUnit: payload[WatchSettingsKey.temperatureUnit] as? String == "fahrenheit" ? "fahrenheit" : "celsius",
      timeFormat: payload[WatchSettingsKey.timeFormat] as? String == "12h" ? "12h" : "24h",
      tiltRatePercent: (payload[WatchSettingsKey.tiltRatePercent] as? NSNumber)
        .map { min(100, max(1, $0.intValue)) } ?? watchDefaultTiltRatePercent
    )
  }

  static func decode(context: [String: Any]) -> WatchSettings {
    decode(context[watchSettingsChannel] as? [String: Any])
  }
}
