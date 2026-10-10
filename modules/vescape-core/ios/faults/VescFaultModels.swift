import Foundation

/// One VESC Fault Occurrence as it crosses the bridge and lives in the durable store.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultCoordinator.kt `VescFaultOccurrence`
/// @parity /modules/vescape-core/src/index.ts `VescFaultOccurrence`
struct VescFaultOccurrence {
  let id: String
  let boardId: String
  let code: Int
  let occurredAtMs: Int64
  var lastObservedAtMs: Int64
  var clearedAtMs: Int64?
  var dismissed: Bool

  func toMap() -> [String: Any?] {
    ["id": id, "boardId": boardId, "code": code, "occurredAtMs": occurredAtMs,
     "lastObservedAtMs": lastObservedAtMs, "clearedAtMs": clearedAtMs, "dismissed": dismissed]
  }
}

protocol VescFaultStoring {
  func getForBoard(_ boardId: String) throws -> [VescFaultOccurrence]
  func getAll() throws -> [VescFaultOccurrence]
  func openLive(_ boardId: String) throws -> VescFaultOccurrence?
  @discardableResult func upsert(_ occurrence: VescFaultOccurrence) throws -> Bool
  @discardableResult func setDismissed(_ id: String, _ dismissed: Bool) throws -> Bool
}
