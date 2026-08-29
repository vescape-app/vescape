import Foundation

/// What one recorded read did. Purely informational; the durable effects are already persisted.
struct VescFaultRegisterRecord {
  let snapshot: VescFaultRegisterSnapshot?
  /// The read was byte-identical to the last complete one: evidence, but nothing new.
  let unchanged: Bool
  /// Entries persisted as discarded link-baseline occurrences.
  let baselineCount: Int
  /// New register-discovered occurrences created.
  let createdCount: Int
  /// The open live occurrence this read enriched, when the match was unambiguous.
  let enrichedOccurrenceId: String?

  static let empty = VescFaultRegisterRecord(
    snapshot: nil, unchanged: false, baselineCount: 0, createdCount: 0, enrichedOccurrenceId: nil
  )

  func with(
    snapshot: VescFaultRegisterSnapshot? = nil,
    unchanged: Bool = false,
    baselineCount: Int = 0,
    createdCount: Int = 0,
    enrichedOccurrenceId: String? = nil
  ) -> VescFaultRegisterRecord {
    VescFaultRegisterRecord(
      snapshot: snapshot, unchanged: unchanged, baselineCount: baselineCount,
      createdCount: createdCount, enrichedOccurrenceId: enrichedOccurrenceId
    )
  }
}

/// Folds retained controller register reads into Board-owned fault evidence.
///
/// Three rules carry the whole design:
///
/// 1. **Raw bytes are the authority.** Every read that changed anything is stored whole, including
///    incomplete ones. A parser that cannot read the output loses the projection, never the bytes.
/// 2. **Incomplete proves nothing.** A partial read is retained as evidence and stops there — it can
///    neither create an occurrence nor establish that the register is empty.
/// 3. **Code is not an identity.** New entries are found by diffing against the previous complete
///    read, not by matching codes across history.
///
/// ### Reconciliation with a live trigger
///
/// The immediate post-trigger read enriches the open live occurrence only when the read produced
/// **exactly one** previously unseen entry. That single new block is the one the activation just
/// caused; two or more is ambiguous and every entry stays a separate register-discovered occurrence.
///
/// The match is deliberately *not* made on the fault code. Refloat's live `ALLDATA` fault codes and
/// the controller's `mc_fault_code` register are different code spaces — comparing them numerically
/// would merge unrelated evidence, which is exactly the fabrication this feature exists to avoid.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultRegisterCoordinator.kt
final class VescFaultRegisterCoordinator {
  /// Stand-in code for a register entry whose firmware fault name this build does not know. The real
  /// name is preserved verbatim in the snapshot; this only keeps the non-null occurrence column
  /// honest about "unknown" instead of guessing a numeric code.
  static let unknownRegisterCode = -1

  /// Snapshots returned to JS per Board. Read models show recent evidence, not all history.
  static let snapshotPage = 20

  static let shared = VescFaultRegisterCoordinator(
    snapshots: VescFaultRegisterStore.shared, faults: VescFaultCoordinator.shared
  )

  private let snapshots: VescFaultRegisterStoring
  private let faults: VescFaultCoordinator
  private let now: () -> Int64
  private let newId: () -> String
  private let lock = NSLock()
  private var baselineRequested = Set<String>()

  init(
    snapshots: VescFaultRegisterStoring,
    faults: VescFaultCoordinator,
    now: @escaping () -> Int64 = { telemetryNowMs() },
    newId: @escaping () -> String = { UUID().uuidString }
  ) {
    self.snapshots = snapshots
    self.faults = faults
    self.now = now
    self.newId = newId
  }

  /// A link or re-link happened: the next successful read for this Board becomes its new comparison
  /// baseline, because a re-addressed controller's register has nothing to do with the old one.
  func requestBaseline(_ boardId: String) {
    lock.lock()
    baselineRequested.insert(boardId)
    lock.unlock()
  }

  /// Reason to use for this Board's next read. A Board that has never had a baseline — including one
  /// saved before this feature existed — gets one on its first successful connection.
  func connectReason(_ boardId: String) -> VescFaultRegisterReason {
    lock.lock()
    let requested = baselineRequested.contains(boardId)
    lock.unlock()
    if requested || !snapshots.hasBaseline(boardId) { return .baseline }
    return .connect
  }

  /// Persist one finished read and fold whatever it proved into occurrence storage.
  @discardableResult
  func record(boardId: String, read: VescFaultRegisterRead) -> VescFaultRegisterRecord {
    guard faults.collectionEnabled else { return .empty }
    let complete = read.status == .complete
    // Nothing arrived at all. That is a failed read, not partial evidence: there are no bytes worth
    // retaining, and a later safe audit will try again.
    if !complete && read.raw.isEmpty { return .empty }
    let previous = snapshots.latestComplete(boardId)
    if complete, let previous, previous.raw == read.raw {
      // Unchanged evidence. Storing it again would grow the table with duplicates and re-running
      // reconciliation against it would duplicate occurrences, which is the one thing audits must
      // never do.
      return VescFaultRegisterRecord.empty.with(snapshot: previous, unchanged: true)
    }
    // Only complete output is parsed. A partial block could name a fault whose context is truncated,
    // and half a fault must not become a durable occurrence.
    let entries = complete ? VescFaultRegisterParser.parse(read.text) : nil
    let snapshot = VescFaultRegisterSnapshot(
      id: newId(), boardId: boardId, readAtMs: now(), reason: read.reason, status: read.status,
      raw: read.raw, text: read.text, entries: entries
    )
    snapshots.insert(snapshot)
    guard let entries else { return VescFaultRegisterRecord.empty.with(snapshot: snapshot) }

    if read.reason == .baseline {
      for entry in entries {
        faults.addRegisterOccurrence(
          boardId: boardId, code: entry.code ?? Self.unknownRegisterCode, source: .baseline,
          registerPosition: entry.position, snapshotId: snapshot.id
        )
      }
      lock.lock()
      baselineRequested.remove(boardId)
      lock.unlock()
      if !entries.isEmpty { faults.emitFor(boardId) }
      return VescFaultRegisterRecord.empty.with(snapshot: snapshot, baselineCount: entries.count)
    }

    let seen = Set((previous?.entries ?? []).map { $0.rawBlock })
    let unseen = entries.filter { !seen.contains($0.rawBlock) }
    if unseen.isEmpty { return VescFaultRegisterRecord.empty.with(snapshot: snapshot) }

    if read.reason == .live, unseen.count == 1, let open = faults.openLiveOccurrence(boardId) {
      faults.enrichFromRegister(
        occurrenceId: open.id, registerPosition: unseen[0].position, snapshotId: snapshot.id
      )
      return VescFaultRegisterRecord.empty.with(snapshot: snapshot, enrichedOccurrenceId: open.id)
    }
    for entry in unseen {
      faults.addRegisterOccurrence(
        boardId: boardId, code: entry.code ?? Self.unknownRegisterCode, source: .register,
        registerPosition: entry.position, snapshotId: snapshot.id
      )
    }
    faults.emitFor(boardId)
    return VescFaultRegisterRecord.empty.with(snapshot: snapshot, createdCount: unseen.count)
  }

  func snapshotsForBoard(_ boardId: String, limit: Int = VescFaultRegisterCoordinator.snapshotPage)
    -> [VescFaultRegisterSnapshot]
  {
    snapshots.getForBoard(boardId, limit: limit)
  }

  func snapshot(_ id: String) -> VescFaultRegisterSnapshot? { snapshots.get(id) }

  /// The newest link baseline for a Board, or nil while none has landed. Linking polls this so it
  /// can show the rider how many faults the controller already held — informational only, and its
  /// absence never fails a Board Link.
  func latestBaseline(_ boardId: String) -> VescFaultRegisterSnapshot? {
    snapshots.getForBoard(boardId, limit: Self.snapshotPage).first { $0.reason == .baseline }
  }
}
