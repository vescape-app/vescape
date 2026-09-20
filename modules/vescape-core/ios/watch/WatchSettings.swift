import Foundation

/// The rider's phone settings, as the wrist sees them. Cold state like the route: it changes when
/// the rider changes a setting, not per tick, so it rides the Application Context and survives a
/// restart or a reconnect instead of being dropped like an undelivered message.
///
/// The payload is a dictionary, not a packed frame: settings arrive one at a time over the life of
/// the app, and a key-value bag is forward- and backward-compatible for free — an older wrist
/// ignores keys it does not know, and a newer wrist falls back to its own default for keys an older
/// phone never sends. That is why there is no version byte here and lanes are numbered in the Watch
/// Frame.
///
/// One file, compiled into both the phone target and the watch target, so the writer and the reader
/// cannot drift — the arrangement `WatchFrame.swift` already uses. Android has to duplicate this by
/// convention across two Gradle modules, which is why it has two `WatchSettings.kt`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchSettings.kt
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchSettings.kt
enum WatchSettingsKey {
  /// Rider colour as the phone stores it: a `#RRGGBB` string, or blank for "no colour chosen".
  static let riderColor = "riderColor"
  /// Board Move strength as a percentage of full scale; the wrist displays it but never applies it.
  static let boardMoveStrengthPercent = "boardMoveStrengthPercent"
  /// Whether the wrist draws the direction arrow over the route. Off hides the arrow, not the route.
  static let navArrowEnabled = "navArrowEnabled"
  static let unitSystem = "unitSystem"
}

/// Channel this bag occupies inside the shared Application Context (see `WatchColdState`).
let watchSettingsChannel = "settings"

/// Phone settings the wrist mirrors. Every field defaults to the wrist's own look, so a phone too
/// old to send a key leaves the wrist on the Android default rather than on a zero.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchSettings.kt `WatchSettings`
struct WatchSettings: Equatable {
  /// `#RRGGBB` / `#AARRGGBB` as the phone's rider palette stores it; nil when the rider has none.
  var riderColor: String?
  /// Null until a phone new enough to send it has pushed; the wrist then shows no number.
  var boardMoveStrengthPercent: Int?
  /// Off by default: an older phone never sends the key, and the arrow is opt-in until it works.
  var navArrowEnabled: Bool = false
  var unitSystem: String = "metric"

  /// What the wrist holds before the first push lands, and what a cleared channel reads as.
  static let wristDefaults = WatchSettings()

  /// The wire bag. Blank, not absent, for a cleared colour: an absent key would look like an older
  /// phone that never sent one, and the wrist could not tell the two apart.
  ///
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchSettingsPusher.kt `push`
  var payload: [String: Any] {
    var payload: [String: Any] = [
      WatchSettingsKey.riderColor: riderColor ?? "",
      WatchSettingsKey.navArrowEnabled: navArrowEnabled,
      WatchSettingsKey.unitSystem: unitSystem,
    ]
    if let boardMoveStrengthPercent { payload[WatchSettingsKey.boardMoveStrengthPercent] = boardMoveStrengthPercent }
    return payload
  }

  /// Read the bag leniently. A missing key is the wrist default, never a zero — `getInt`-style
  /// coercion of an absent strength would read as 0 %, which is a number the rider never chose.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MainActivity.kt `readSettings`
  static func decode(_ payload: [String: Any]?) -> WatchSettings {
    guard let payload else { return wristDefaults }
    let color = (payload[WatchSettingsKey.riderColor] as? String)?
      .trimmingCharacters(in: .whitespaces)
    return WatchSettings(
      riderColor: (color?.isEmpty ?? true) ? nil : color,
      boardMoveStrengthPercent: (payload[WatchSettingsKey.boardMoveStrengthPercent] as? NSNumber)?.intValue,
      navArrowEnabled: payload[WatchSettingsKey.navArrowEnabled] as? Bool ?? wristDefaults.navArrowEnabled,
      unitSystem: payload[WatchSettingsKey.unitSystem] as? String == "imperial" ? "imperial" : "metric"
    )
  }

  /// The settings channel of a whole Application Context. An absent channel is the wrist default,
  /// which is also what an unpaired-then-repaired watch reads before the phone pushes again.
  static func decode(context: [String: Any]) -> WatchSettings {
    decode(context[watchSettingsChannel] as? [String: Any])
  }
}

/// A rider colour resolved to components. Deliberately not a `Color`: this file is compiled into
/// the phone target too, and the wrist is the only place that paints with it.
struct WatchRiderColor: Equatable {
  var red: Double
  var green: Double
  var blue: Double
}

/// `#RRGGBB` / `#AARRGGBB` (the form the phone's rider palette stores) into components. Anything
/// else — blank, a colour name, a future format — is nil, which leaves the wrist on its own palette
/// rather than drawing a route in a colour nobody picked. Alpha is parsed and dropped: the wrist
/// draws its own opacity, and a rider colour that arrived half-transparent would read as a dim lane.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchSettings.kt `parseRiderColor`
func parseWatchRiderColor(_ value: String?) -> WatchRiderColor? {
  guard var hex = value?.trimmingCharacters(in: .whitespaces) else { return nil }
  if hex.hasPrefix("#") { hex.removeFirst() }
  guard hex.count == 6 || hex.count == 8 else { return nil }
  guard let rgb = UInt32(hex, radix: 16) else { return nil }
  return WatchRiderColor(
    red: Double((rgb >> 16) & 0xff) / 255,
    green: Double((rgb >> 8) & 0xff) / 255,
    blue: Double(rgb & 0xff) / 255
  )
}
