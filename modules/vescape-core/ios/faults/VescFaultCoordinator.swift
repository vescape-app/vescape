import Foundation

/// Deterministic owner of VESC Fault Occurrence transitions.
///
/// Refloat's `ALLDATA` fault mode is a **state signal**, not a Telemetry Sample: this coordinator
/// turns a stream of observed active codes into distinct durable activations, independent of Ride
/// Recording, Ride History, and Board Warnings.
///
/// Rules:
/// - active code changes from none or another code -> close any open occurrence, open a new one;
/// - the same code repeating -> one occurrence, its `lastObservedAt` advanced (write-throttled);
/// - a normal `ALLDATA` frame -> the open occurrence is cleared;
/// - Board Session loss -> **nothing**. Losing the session proves neither a clear nor a second
///   activation, so the occurrence stays open and the same code returning continues it.
///
/// Every input is injected (clock, id minting, store, collection switch), so clear, code change,
/// repetition, disconnect, restart, and setting changes are all testable without hardware.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultCoordinator.kt
final class VescFaultCoordinator {
  /// A continuously active fault refreshes its `lastObservedAt` at most this often.
  static let observationWriteIntervalMs: Int64 = 1_000

  static let shared = VescFaultCoordinator(store: VescFaultStore.shared)

  private let store: VescFaultStoring
  private let now: () -> Int64
  private let newId: () -> String
  private let lock = NSLock()
  private var active: [String: VescFaultOccurrence] = [:]
  private var hydrated = Set<String>()

  /// Set by the bridge to push the full fault list for one Board to JS on every change.
  var onChange: ((String, [VescFaultOccurrence]) -> Void)?

  /// Copy the past telemetry snapshot once, after the new occurrence is persisted.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultCoordinator.kt `onOccurrenceOpened`
  var onOccurrenceOpened: ((VescFaultOccurrence) -> Void)?

  /// `VESC Fault Collection` App Setting, mirrored here by the session controller. Off stops live
  /// trigger handling and every new write; stored occurrences stay readable and dismissible.
  /// Independent of `boardWarningsEnabled`.
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

  /// Refloat reported an active fault code. Idempotent per code: repeated frames extend the same
  /// occurrence instead of creating rows.
  func onActiveFault(boardId: String, code: Int) {
    guard collectionEnabled else { return }
    guard hydrate(boardId) else { return }
    let timestamp = now()
    lock.lock()
    let current = active[boardId]
    lock.unlock()

    if let current, current.code == code {
      // Same continuously active fault. Only persist when the observation moved the needle, so a
      // 30 Hz fault stream is not a 30 Hz write loop.
      guard timestamp - current.lastObservedAtMs >= Self.observationWriteIntervalMs else { return }
      var updated = current
      updated.lastObservedAtMs = timestamp
      // Persist first: a failed write must not leave memory claiming a transition the durable store
      // never took, because the controller-level edge dedupe would never retry it.
      do { guard try store.upsert(updated) else { return } }
      catch { Self.reportWrite("vesc_fault_observation", error); return }
      lock.lock()
      active[boardId] = updated
      lock.unlock()
      return
    }

    // A direct code change closes the old activation and opens a new one — two distinct faults.
    if var current {
      current.clearedAtMs = timestamp
      current.lastObservedAtMs = timestamp
      // Close the old activation durably before opening its replacement. Otherwise a failed close
      // leaves an orphaned open row that later clear heartbeats — which only know the replacement —
      // can never repair.
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

  /// Refloat reported normal `ALLDATA` — any open occurrence for this Board is cleared.
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
    // Persist the clear before forgetting the occurrence: if the write fails, the occurrence stays
    // active in memory and the next clear observation retries it.
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

  /// Every occurrence across all Boards — the JS foreground catch-up pull.
  func allFaults() throws -> [VescFaultOccurrence] { try store.getAll() }

  /// Emit the current faults for every Board that has any — used on late subscribe.
  func emitSnapshot() {
    let faults: [VescFaultOccurrence]
    do { faults = try store.getAll() }
    catch { RecordingStorageFailure.reportRead(operation: "vesc_fault_snapshot", error: error); return }
    for (boardId, faults) in Dictionary(grouping: faults, by: { $0.boardId }) {
      onChange?(boardId, faults)
    }
  }

  /// Adopt the newest still-open live occurrence as in-memory state the first time a Board is seen.
  /// Without this, an app restart mid-fault would open a duplicate activation for the same fault.
  /// Returns false when hydration could not be established, and the caller must decide nothing:
  /// acting on an unknown prior state would open a duplicate alongside a durable open occurrence.
  /// A failed read leaves the Board unhydrated, so the next observation retries.
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
