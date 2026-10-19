import Foundation

/// Wrist-side store, shared between the watch app and its WidgetKit extension. Both derive the
/// App Group suite from their own bundle identity. Compiled into the phone module only for tests.
enum WatchBatteryDefaults {
  static let widgetKind = "VescapeBoardBattery"
  static var suiteName: String {
    let id = Bundle.main.bundleIdentifier ?? ""
    let phone = id.components(separatedBy: ".watchkitapp").first ?? id
    return "group.\(phone).watch"
  }
  static var defaults: UserDefaults? { UserDefaults(suiteName: suiteName) }
  static var value: WatchLastBattery? { WatchLastBattery.decode(defaults?.dictionary(forKey: watchLastBatteryChannel)) }
  /// Application Context is the only authority. Queued complication transfers only wake this reader.
  /// Reading at apply time also avoids replaying an older callback after a newer context arrived.
  static func receiveLatestContext(_ context: () -> [String: Any], store: UserDefaults? = defaults) -> Bool {
    guard let store, let payload = context()[watchLastBatteryChannel] as? [String: Any] else { return false }
    let value = WatchLastBattery.decode(payload)
    guard value != WatchLastBattery.decode(store.dictionary(forKey: watchLastBatteryChannel)) else { return false }
    store.set(value?.payload ?? [:], forKey: watchLastBatteryChannel)
    return true
  }
}
