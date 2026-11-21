import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultCoordinator.kt
final class VescFaultCoordinator {
  static let observationWriteIntervalMs: Int64 = 1_000

  static let shared = VescFaultCoordinator(store: VescFaultStore.shared)

  private let store: VescFaultStoring
  private let now: () -> Int64
  private let newId: () -> String
  private let lock = NSLock()
  private var active: [String: VescFaultOccurrence] = [:]
  private var hydrated = Set<String>()

  var onChange: ((String, [VescFaultOccurrence]) -> Void)?

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultCoordinator.kt `onOccurrenceOpened`
  var onOccurrenceOpened: ((VescFaultOccurrence) -> Void)?

  var collectionEnabled = true

  init(
    store: VescFaultStoring,
    now: @escaping () -> Int64 = { telemetryNowMs() },
    newId: @escaping () -> String = { UUID().uuidString }
  ) {
    self.store = store
    self.now = now
    self.newId = newId
  }

  func onActiveFault(boardId: String, code: Int) {
    guard collectionEnabled else { return }
    guard hydrate(boardId) else { return }
    let timestamp = now()
    lock.lock()
    let current = active[boardId]
    lock.unlock()

    if let current, current.code == code {
      guard timestamp - current.lastObservedAtMs >= Self.observationWriteIntervalMs else { return }
      var updated = current
      updated.lastObservedAtMs = timestamp
      do { guard try store.upsert(updated) else { return } }
      catch { Self.reportWrite("vesc_fault_observation", error); return }
      lock.lock()
      active[boardId] = updated
      lock.unlock()
      return
    }

    if var current {
      current.clearedAtMs = timestamp
      current.lastObservedAtMs = timestamp
      do { guard try store.upsert(current) else { return } }
      catch { Self.reportWrite("vesc_fault_close_for_code_change", error); return }
    }

    let opened = VescFaultOccurrence(
      id: newId(),
      boardId: boardId,
      code: code,
      occurredAtMs: timestamp,
      lastObservedAtMs: timestamp,
      clearedAtMs: nil,
      dismissed: false
    )
    do { guard try store.upsert(opened) else { return } }
    catch { Self.reportWrite("vesc_fault_open", error); return }
    lock.lock()
    active[boardId] = opened
    lock.unlock()
    onOccurrenceOpened?(opened)
    do { try emit(boardId) }
    catch { RecordingStorageFailure.reportRead(operation: "vesc_fault_reload_after_open", error: error) }
  }

  func onFaultCleared(boardId: String) {
    guard collectionEnabled else { return }
    guard hydrate(boardId) else { return }
    lock.lock()
    let existing = active[boardId]
    lock.unlock()
    guard var current = existing else { return }
    let timestamp = now()
    current.clearedAtMs = timestamp
    current.lastObservedAtMs = max(current.lastObservedAtMs, timestamp)
    do { guard try store.upsert(current) else { return } }
    catch { Self.reportWrite("vesc_fault_clear", error); return }
    lock.lock()
    active.removeValue(forKey: boardId)
    lock.unlock()
    do { try emit(boardId) }
    catch { RecordingStorageFailure.reportRead(operation: "vesc_fault_reload_after_clear", error: error) }
  }

  func setDismissed(id: String, dismissed: Bool) throws {
    guard try store.setDismissed(id, dismissed) else { return }
    lock.lock()
    for (boardId, occurrence) in active where occurrence.id == id {
      active[boardId]?.dismissed = dismissed
    }
    lock.unlock()
    do {
      guard let boardId = try store.getAll().first(where: { $0.id == id })?.boardId else { return }
      try emit(boardId)
    } catch {
      RecordingStorageFailure.reportRead(operation: "vesc_fault_reload_after_dismiss", error: error)
    }
  }

  func allFaults() throws -> [VescFaultOccurrence] { try store.getAll() }

  func emitSnapshot() {
    let faults: [VescFaultOccurrence]
    do { faults = try store.getAll() }
    catch { RecordingStorageFailure.reportRead(operation: "vesc_fault_snapshot", error: error); return }
    for (boardId, faults) in Dictionary(grouping: faults, by: { $0.boardId }) {
      onChange?(boardId, faults)
    }
  }

  private func hydrate(_ boardId: String) -> Bool {
    lock.lock()
    let alreadyHydrated = hydrated.contains(boardId)
    lock.unlock()
    guard !alreadyHydrated else { return true }

    let open: VescFaultOccurrence?
    do {
      open = try store.openLive(boardId)
    } catch {
      RecordingStorageFailure.reportRead(operation: "vesc_fault_open_read", error: error)
      return false
    }

    lock.lock()
    hydrated.insert(boardId)
    if let open, active[boardId] == nil { active[boardId] = open }
    lock.unlock()
    return true
  }

  private func emit(_ boardId: String) throws {
    onChange?(boardId, try store.getForBoard(boardId))
  }

  private static func reportWrite(_ operation: String, _ error: Error) {
    RecordingStorageFailure.report(operation: operation, category: "write_failed", error: error)
  }
}
