import Foundation

let watchLastBatteryChannel = "lastBattery"

/// Latest persisted reading. `percent` and `at` are both set or both nil (never seen); an empty
/// payload clears the board. Nil keys are omitted because WatchConnectivity property lists cannot
/// encode null.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchLastBattery.kt
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchLastBattery.kt
struct WatchLastBattery: Equatable {
  let boardId: String
  let boardName: String
  let percent: Double?
  let at: Int64?

  /// The selected Board as `AppDataRepository.getBoard` returns it; nil without a live selection.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchLastBattery.kt `selected`
  static func selected(boardId: String?, board: [String: Any?]?) -> WatchLastBattery? {
    guard let boardId, let board, (board["deletedAt"] ?? nil) == nil else { return nil }
    let stored = (board["lastBattery"] ?? nil) as? [String: Any?]
    let percent = ((stored?["percent"] ?? nil) as? Double).flatMap { $0.isFinite ? $0 : nil }
    let at = (stored?["at"] ?? nil) as? Int64
    let known = percent != nil && at != nil
    return WatchLastBattery(boardId: boardId, boardName: (board["name"] ?? nil) as? String ?? "Board",
      percent: known ? percent : nil, at: known ? at : nil)
  }

  var payload: [String: Any] {
    var result: [String: Any] = ["boardId": boardId, "boardName": boardName]
    if let percent, let at { result["percent"] = percent; result["at"] = at }
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

  func ageLabel(now: Date) -> String? { age(now: now).map { "\($0) ago" } }

  /// Entries land at the reading's age boundaries, not wall-clock hours.
  func timelineDates(now: Date) -> [Date] {
    guard let at, percent != nil else { return [now] }
    let origin = Date(timeIntervalSince1970: Double(at) / 1000)
    let firstHour = max(1, Int(now.timeIntervalSince(origin) / 3600) + 1)
    return [now] + (firstHour..<(firstHour + 48)).map { origin.addingTimeInterval(Double($0) * 3600) }
  }
}
