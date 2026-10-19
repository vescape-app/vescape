import Foundation

let watchLastBatteryChannel = "lastBattery"

/// Latest persisted reading. Missing percent/at means never seen; an empty payload clears the board.
/// Optional keys are omitted because WatchConnectivity property lists cannot encode null.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchLastBattery.kt
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchLastBattery.kt
struct WatchLastBattery: Equatable {
  let boardId: String
  let boardName: String
  let percent: Double?
  let at: Int64?

  var payload: [String: Any] {
    var result: [String: Any] = ["boardId": boardId, "boardName": boardName]
    if let percent, percent.isFinite, let at { result["percent"] = percent; result["at"] = at }
    return result
  }

  static func decode(_ payload: [String: Any]?) -> WatchLastBattery? {
    guard let payload, let id = payload["boardId"] as? String, !id.isEmpty,
      let name = payload["boardName"] as? String else { return nil }
    let percent = payload["percent"] as? Double
    let at = (payload["at"] as? NSNumber)?.int64Value
    let known = percent.map { $0.isFinite && (0...100).contains($0) } == true && at != nil
    return WatchLastBattery(boardId: id, boardName: name, percent: known ? percent : nil, at: known ? at : nil)
  }

  var text: String { percent.map { WatchGauge.batteryPercent($0) } ?? "--" }

  /// @parity /src/modules/board/components/BatteryIndicator.tsx
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchLastBattery.kt `age`
  func age(now: Date) -> String? {
    guard let at, percent != nil else { return nil }
    let hours = max(0, Int64(now.timeIntervalSince1970 * 1000) - at) / 3_600_000
    if hours < 1 { return nil }
    return hours < 24 ? "\(hours)h" : "\(hours / 24)d"
  }

  /// Entries land at the reading's age boundaries, not wall-clock hours.
  func timelineDates(now: Date) -> [Date] {
    guard let at, percent != nil else { return [now] }
    let origin = Date(timeIntervalSince1970: Double(at) / 1000)
    let firstHour = max(1, Int(now.timeIntervalSince(origin) / 3600) + 1)
    return [now] + (firstHour..<(firstHour + 48)).map { origin.addingTimeInterval(Double($0) * 3600) }
  }
}

/// Shared between the watch app and its WidgetKit extension. Both derive the suite from identity.
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
  /// Wear reads its latest Data Layer item directly; no queued snapshot is applied there either.
  static func receiveLatestContext(_ context: () -> [String: Any], store: UserDefaults? = defaults) -> Bool {
    guard let store, let payload = context()[watchLastBatteryChannel] as? [String: Any] else { return false }
    let value = WatchLastBattery.decode(payload)
    guard value != WatchLastBattery.decode(store.dictionary(forKey: watchLastBatteryChannel)) else { return false }
    store.set(value?.payload ?? [:], forKey: watchLastBatteryChannel)
    return true
  }
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/BatteryComplicationService.kt
/// @platform-diff Only iOS budgets complication wake transfers. Cold state always updates.
struct WatchBatteryWakeGate {
  static let reserve = 5
  private(set) var lastKey: String?
  mutating func shouldSend(_ battery: WatchLastBattery?, remaining: Int) -> Bool {
    let key = "\(battery?.boardId ?? ""):\(battery?.boardName ?? ""):\(battery?.text ?? "--")"
    guard key != lastKey, remaining > Self.reserve else { return false }
    lastKey = key
    return true
  }
}
