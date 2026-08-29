import Foundation

/// Where a VESC Fault Occurrence came from.
///
/// - `live`: Refloat `ALLDATA` fault mode observed during a Board Session. Occurrence time is known.
/// - `register`: reconciled from the controller's retained `faults` register (#432). Occurrence time
///   is unknown; only discovery time is.
/// - `baseline`: register content already present when the Board was linked. Kept as evidence, never
///   drives the Board health indicator.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultCoordinator.kt `VescFaultSource`
/// @parity /modules/vescape-core/src/index.ts `VescFaultSource`
enum VescFaultSource: String {
  case live
  case register
  case baseline
}

/// One VESC Fault Occurrence as it crosses the bridge and lives in the durable store.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultCoordinator.kt `VescFaultOccurrence`
/// @parity /modules/vescape-core/src/index.ts `VescFaultOccurrence`
struct VescFaultOccurrence {
  let id: String
  let boardId: String
  let code: Int
  let source: VescFaultSource
  /// Null when the occurrence time is unknown (register-sourced evidence carries no timestamp).
  let occurredAtMs: Int64?
  let discoveredAtMs: Int64
  var lastObservedAtMs: Int64
  var clearedAtMs: Int64?
  var registerPosition: Int?
  var dismissed: Bool

  func toMap() -> [String: Any?] {
    [
      "id": id,
      "boardId": boardId,
      "code": code,
      "source": source.rawValue,
      "occurredAtMs": occurredAtMs,
      "discoveredAtMs": discoveredAtMs,
      "lastObservedAtMs": lastObservedAtMs,
      "clearedAtMs": clearedAtMs,
      "registerPosition": registerPosition,
      "dismissed": dismissed,
    ]
  }
}

/// Narrow durable persistence for VESC Fault Occurrences. Production is `VescFaultStore`; tests
/// supply an in-memory fake so the transition rules are exercised without a database or BLE.
protocol VescFaultStoring {
  func getForBoard(_ boardId: String) -> [VescFaultOccurrence]
  func getAll() -> [VescFaultOccurrence]
  /// Newest still-open live occurrence for a Board, used to rehydrate state after a restart.
  func openLive(_ boardId: String) -> VescFaultOccurrence?
  /// Returns false when the write failed, so callers can keep in-memory state unresolved.
  @discardableResult func upsert(_ occurrence: VescFaultOccurrence) -> Bool
  @discardableResult func setDismissed(_ id: String, _ dismissed: Bool) -> Bool
}

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
    hydrate(boardId)
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
      guard store.upsert(updated) else { return }
      lock.lock()
      active[boardId] = updated
      lock.unlock()
      return
    }

    // A direct code change closes the old activation and opens a new one — two distinct faults.
    if var current {
      current.clearedAtMs = timestamp
      current.lastObservedAtMs = timestamp
      store.upsert(current)
    }

    let opened = VescFaultOccurrence(
      id: newId(),
      boardId: boardId,
      code: code,
      source: .live,
      occurredAtMs: timestamp,
      discoveredAtMs: timestamp,
      lastObservedAtMs: timestamp,
      clearedAtMs: nil,
      registerPosition: nil,
      dismissed: false
    )
    guard store.upsert(opened) else { return }
    lock.lock()
    active[boardId] = opened
    lock.unlock()
    emit(boardId)
  }

  /// Refloat reported normal `ALLDATA` — any open occurrence for this Board is cleared.
  func onFaultCleared(boardId: String) {
    guard collectionEnabled else { return }
    hydrate(boardId)
    lock.lock()
    let existing = active[boardId]
    lock.unlock()
    guard var current = existing else { return }
    let timestamp = now()
    current.clearedAtMs = timestamp
    current.lastObservedAtMs = max(current.lastObservedAtMs, timestamp)
    // Persist the clear before forgetting the occurrence: if the write fails, the occurrence stays
    // active in memory and the next clear observation retries it.
    guard store.upsert(current) else { return }
    lock.lock()
    active.removeValue(forKey: boardId)
    lock.unlock()
    emit(boardId)
  }

  /// The Board Session ended while a fault may have been active. Deliberately does not close the
  /// occurrence: the controller never said "cleared", and inventing one would fabricate evidence.
  /// In-memory continuity is kept so the same code seen after a reconnect is the same activation.
  func onSessionLost(boardId: String) {}

  func setDismissed(id: String, dismissed: Bool) {
    guard store.setDismissed(id, dismissed) else { return }
    lock.lock()
    for (boardId, occurrence) in active where occurrence.id == id {
      active[boardId]?.dismissed = dismissed
    }
    lock.unlock()
    guard let boardId = store.getAll().first(where: { $0.id == id })?.boardId else { return }
    emit(boardId)
  }

  func faultsForBoard(_ boardId: String) -> [VescFaultOccurrence] { store.getForBoard(boardId) }

  /// Every occurrence across all Boards — the JS foreground catch-up pull.
  func allFaults() -> [VescFaultOccurrence] { store.getAll() }

  /// Emit the current faults for every Board that has any — used on late subscribe.
  func emitSnapshot() {
    for (boardId, faults) in Dictionary(grouping: store.getAll(), by: { $0.boardId }) {
      onChange?(boardId, faults)
    }
  }

  /// Adopt the newest still-open live occurrence as in-memory state the first time a Board is seen.
  /// Without this, an app restart mid-fault would open a duplicate activation for the same fault.
  private func hydrate(_ boardId: String) {
    lock.lock()
    let isNew = hydrated.insert(boardId).inserted
    lock.unlock()
    guard isNew, let open = store.openLive(boardId) else { return }
    lock.lock()
    if active[boardId] == nil { active[boardId] = open }
    lock.unlock()
  }

  private func emit(_ boardId: String) {
    onChange?(boardId, store.getForBoard(boardId))
  }
}
