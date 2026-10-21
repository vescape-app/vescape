/// Phone-side dedupe for complication wake transfers: one per change the complication can show.
/// The transfer budget reserve is checked by the caller first, so an exhausted budget never
/// consumes a change.
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchLastBattery.kt `BatteryUpdateGate`
/// @platform-diff Only iOS budgets complication wake transfers, so the gate runs on the phone;
///   Wear dedupes on the wrist when the Data Layer item changes.
struct WatchBatteryWakeGate {
  static let reserve = 5
  private(set) var lastKey: String?
  mutating func shouldSend(_ battery: WatchLastBattery?) -> Bool {
    let key = "\(battery?.boardId ?? ""):\(battery?.boardName ?? ""):\(battery?.text ?? "--")"
    guard key != lastKey else { return false }
    lastKey = key
    return true
  }
}
