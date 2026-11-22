import Foundation

enum WatchBatteryDefaults {
  static let widgetKind = "VescapeBoardBattery"
  static var suiteName: String {
    let id = Bundle.main.bundleIdentifier ?? ""
    let phone = id.components(separatedBy: ".watchkitapp").first ?? id
    return "group.\(phone).watch"
  }
  static var defaults: UserDefaults? { UserDefaults(suiteName: suiteName) }
  static var value: WatchLastBattery? { WatchLastBattery.decode(defaults?.dictionary(forKey: watchLastBatteryChannel)) }
  static func receiveLatestContext(_ context: () -> [String: Any], store: UserDefaults? = defaults) -> Bool {
    guard let store, let payload = context()[watchLastBatteryChannel] as? [String: Any] else { return false }
    let value = WatchLastBattery.decode(payload)
    guard value != WatchLastBattery.decode(store.dictionary(forKey: watchLastBatteryChannel)) else { return false }
    store.set(value?.payload ?? [:], forKey: watchLastBatteryChannel)
    return true
  }
}
