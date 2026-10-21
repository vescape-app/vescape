import Foundation

/// Durable Board Warning registry — the single owner of every warning lifecycle rule (automotive
/// fault-code model). Detectors stay pure evaluation logic and report through this registry:
///
/// - `reportFinding`: a detector found a problem. Upsert one row per (boardId, kind), preserving
///   `firstDetectedAt` while refreshing severity/payload/`lastDetectedAt`.
/// - `reportCleanEvaluation`: a detector evaluated the kind **with real data** and the condition was
///   gone. Auto-clears the row. A detector with no data that session calls nothing, so no-data
///   sessions leave rows untouched.
/// - `clearWarning` / `clearAllWarnings`: manual clears delete rows; a still-true condition re-fires.
///
/// First fire of each kind within a Board Session records exactly one Diagnostic Event through the
/// existing reporter. `beginSession` resets that per-session bookkeeping so every future detector
/// gets the breadcrumb for free.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/warnings/BoardWarningRegistry.kt
final class BoardWarningRegistry {
  /// Severity lives in the pure warning model (`BoardWarningKind.swift`); kept as a nested alias so
  /// existing `BoardWarningRegistry.Severity` call sites stay valid.
  typealias Severity = BoardWarningSeverity

  static let shared = BoardWarningRegistry(
    store: .shared,
    recordDiagnostic: { name, props in
      TelemetryRepository.shared.recordDiagnosticEvent(eventName: name, properties: props)
    }
  )

  private let store: BoardWarningStore
  private let recordDiagnostic: (String, [String: Any?]) -> Void
  private let now: () -> Int64
  private let lock = NSLock()
  private var firedThisSession = Set<String>()

  /// Set by the bridge to push the full board list to JS on every change.
  var onChange: ((String, [BoardWarning]) -> Void)?

  /// Set by the session controller: a manual clear resets the matching telemetry detector's dedupe so
  /// a still-true condition re-fires within the same Board Session (`kind == nil` means all kinds).
  /// Invoked even when no row was deleted, so a warning lost to a swallowed write is also re-armed.
  var onManualClear: ((String, String?) -> Void)?

  init(
    store: BoardWarningStore,
    recordDiagnostic: @escaping (String, [String: Any?]) -> Void,
    now: @escaping () -> Int64 = { telemetryNowMs() }
  ) {
    self.store = store
    self.recordDiagnostic = recordDiagnostic
    self.now = now
  }

  private func sessionKey(_ boardId: String, _ kind: String) -> String { "\(boardId) \(kind)" }

  /// Reset first-fire breadcrumb bookkeeping for a board when a new Board Session starts.
  func beginSession(_ boardId: String) {
    lock.lock()
    firedThisSession = firedThisSession.filter { !$0.hasPrefix("\(boardId) ") }
    lock.unlock()
  }

  /// Typed detector path: a detector found a problem for a known `BoardWarningKind`.
  func reportFinding(boardId: String, kind: BoardWarningKind, severity: Severity, payloadJson: String) {
    reportFinding(boardId: boardId, kind: kind.rawValue, severity: severity, payloadJson: payloadJson)
  }

  /// Raw path: manual/dev injection of an arbitrary kind slug (including kinds JS may not know).
  func reportFinding(boardId: String, kind: String, severity: Severity, payloadJson: String) {
    let timestamp = now()
    let existing: BoardWarning?
    do { existing = try store.get(boardId, kind) }
    catch { RecordingStorageFailure.reportRead(operation: "board_warning_existing_read", error: error); return }
    let warning = BoardWarning(
      boardId: boardId,
      kind: kind,
      severity: severity.rawValue,
      firstDetectedAtMs: existing?.firstDetectedAtMs ?? timestamp,
      lastDetectedAtMs: timestamp,
      payloadJson: payloadJson
    )
    do { try store.upsert(warning) }
    catch { RecordingStorageFailure.report(operation: "board_warning_upsert", category: "write_failed", error: error); return }

    lock.lock()
    let isFirstFireThisSession = firedThisSession.insert(sessionKey(boardId, kind)).inserted
    lock.unlock()
    if isFirstFireThisSession {
      recordDiagnostic(
        "board_warning_detected",
        [
          "operation": "warning",
          "board_id": boardId,
          "kind": kind,
          "severity": severity.rawValue,
          "message": "Board warning: \(kind) (\(severity.rawValue))",
        ]
      )
    }
    do { try emit(boardId) }
    catch { RecordingStorageFailure.reportRead(operation: "board_warnings_reload", error: error) }
  }

  /// Typed detector path: the kind evaluated with real data and the condition was gone.
  func reportCleanEvaluation(boardId: String, kind: BoardWarningKind) {
    reportCleanEvaluation(boardId: boardId, kind: kind.rawValue)
  }

  func reportCleanEvaluation(boardId: String, kind: String) {
    let deleted: Bool
    do { deleted = try store.delete(boardId, kind) }
    catch { RecordingStorageFailure.report(operation: "board_warning_clean", category: "write_failed", error: error); return }
    guard deleted else { return }
    do { try emit(boardId) }
    catch { RecordingStorageFailure.reportRead(operation: "board_warnings_reload_after_clean", error: error) }
  }

  func clearWarning(boardId: String, kind: String) throws {
    if try store.delete(boardId, kind) {
      do { try emit(boardId) }
      catch { RecordingStorageFailure.reportRead(operation: "board_warnings_reload_after_clear", error: error) }
    }
    onManualClear?(boardId, kind)
  }

  func clearAllWarnings(boardId: String) throws {
    if try store.deleteForBoard(boardId) {
      do { try emit(boardId) }
      catch { RecordingStorageFailure.reportRead(operation: "board_warnings_reload_after_clear_all", error: error) }
    }
    onManualClear?(boardId, nil)
  }

  func warningsForBoard(_ boardId: String) throws -> [BoardWarning] { try store.getForBoard(boardId) }

  /// Every current warning across all boards — used for the JS foreground catch-up pull.
  func allWarnings() throws -> [BoardWarning] { try store.getAll() }

  /// Emit the current warnings for every board that has any — used on late subscribe.
  func emitSnapshot() {
    let warnings: [BoardWarning]
    do { warnings = try store.getAll() }
    catch { RecordingStorageFailure.reportRead(operation: "board_warnings_snapshot", error: error); return }
    let byBoard = Dictionary(grouping: warnings, by: { $0.boardId })
    for (boardId, warnings) in byBoard { onChange?(boardId, warnings) }
  }

  private func emit(_ boardId: String) throws {
    onChange?(boardId, try store.getForBoard(boardId))
  }
}
