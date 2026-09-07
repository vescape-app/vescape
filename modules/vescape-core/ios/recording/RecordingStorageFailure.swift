import Foundation
import GRDB
#if canImport(Sentry)
import Sentry
#endif

internal enum RecordingStorageFailureKind: String {
  case writeFailed = "write_failed"
  case storageUnavailable = "storage_unavailable"
  case fullDisk = "full_disk"
}

internal func recordingFailureState(_ kind: RecordingStorageFailureKind) -> [String: Any] {
  ["kind": kind.rawValue, "storageUnavailable": kind != .writeFailed]
}

internal func resolveRecordingFailureKind(
  current: RecordingStorageFailureKind?, incoming: RecordingStorageFailureKind
) -> RecordingStorageFailureKind {
  if let current, current != .writeFailed { return current }
  return incoming
}

internal struct StorageUnavailableError: LocalizedError {
  let kind: RecordingStorageFailureKind
  var errorDescription: String? { "Local storage is unavailable (\(kind.rawValue))" }
}

internal final class RecordingWriteGate {
  private let lock = NSLock()
  private var accepting = true
  private let onFailure: (Error) -> Void
  init(onFailure: @escaping (Error) -> Void) { self.onFailure = onFailure }
  func isAccepting() -> Bool { lock.lock(); defer { lock.unlock() }; return accepting }
  func fail(_ error: Error) {
    lock.lock()
    guard accepting else { lock.unlock(); return }
    accepting = false
    lock.unlock()
    onFailure(error)
  }
}

internal final class RecordingCommitBoundary {
  private let gate: RecordingWriteGate
  init(onFailure: @escaping (Error) -> Void) { gate = RecordingWriteGate(onFailure: onFailure) }
  func isAccepting() -> Bool { gate.isAccepting() }
  func commit(_ transaction: () throws -> Void) -> Bool {
    guard gate.isAccepting() else { return false }
    do { try transaction(); return true }
    catch { gate.fail(error); return false }
  }
}

/// Native-owned recording failure episode.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/recording/RecordingStorageFailure.kt
/// @parity /modules/vescape-core/src/index.ts `RecordingFailureState`
internal enum RecordingStorageFailure {
  private static let key = "vescape.storage.failure.kind"
  private static var current: RecordingStorageFailureKind? =
    UserDefaults.standard.string(forKey: key).flatMap(RecordingStorageFailureKind.init(rawValue:))
  private static let lock = NSRecursiveLock()
  private static var startupChecked = false
  private static var failureGeneration: UInt64 = 0
  private static var outageListener: (() -> Void)?
  private static let reporter = NativeFailureReporter { report in
#if canImport(Sentry)
    SentrySDK.capture(message: "Local persistence operation failed") { scope in
      scope.setLevel(.error)
      scope.setFingerprint(["persistence", report.category, report.operation])
      scope.setTag(value: report.operation, key: "persistence.operation")
      scope.setTag(value: report.category, key: "persistence.category")
      scope.setExtra(value: report.errorType, key: "persistence.error_type")
    }
#endif
  }

  static func initialize() {
    startupCheck {
      let pool = try TelemetryDatabase.requirePool()
      try pool.write { db in
        try db.execute(sql: "CREATE TABLE storage_startup_probe (value INTEGER NOT NULL)")
        try db.execute(sql: "INSERT INTO storage_startup_probe (value) VALUES (1)")
        try db.execute(sql: "DROP TABLE storage_startup_probe")
      }
    }
  }

  static func startupCheck(
    reportFailure: (String, String, Error) -> Void = { operation, category, error in
      reporter.report(operation: operation, category: category, error: error)
    },
    _ check: () throws -> Void
  ) {
    lock.lock()
    guard !startupChecked else { lock.unlock(); return }
    startupChecked = true
    let generationAtStart = failureGeneration
    lock.unlock()
    do {
      try check()
      lock.lock()
      let clear = failureGeneration == generationAtStart
      if clear { current = nil }
      lock.unlock()
      if clear {
        UserDefaults.standard.removeObject(forKey: key)
        lock.lock(); let raced = current; lock.unlock()
        if let raced { UserDefaults.standard.set(raced.rawValue, forKey: key) }
      }
    } catch {
      let classified = classify(error)
      let startupKind = classified == .writeFailed ? .storageUnavailable : classified
      reportFailure("storage_startup_probe", startupKind.rawValue, error)
      lock.lock()
      let changed = recordFailureLocked(kind: startupKind)
      lock.unlock()
      if changed { notifyOutage() }
    }
  }

  static func value() -> RecordingStorageFailureKind? {
    lock.lock(); defer { lock.unlock() }
    return current
  }

  static func requireAvailable() throws {
    if let kind = value(), kind != .writeFailed { throw StorageUnavailableError(kind: kind) }
  }

  static func observeOutage(_ listener: (() -> Void)?) {
    lock.lock(); outageListener = listener; lock.unlock()
  }

#if DEBUG
  static func resetForTesting() {
    lock.lock()
    current = nil
    startupChecked = false
    failureGeneration = 0
    outageListener = nil
    lock.unlock()
    UserDefaults.standard.removeObject(forKey: key)
  }
#endif

  @discardableResult static func fail(_ error: Error) -> RecordingStorageFailureKind {
    let kind = classify(error)
    lock.lock()
    let resolved = resolveRecordingFailureKind(current: current, incoming: kind)
    let changed = recordFailureLocked(kind: kind)
    lock.unlock()
    reporter.report(operation: "recording_commit", category: resolved.rawValue, error: error)
    if changed { notifyOutage() }
    return resolved
  }

  @discardableResult private static func recordFailureLocked(kind: RecordingStorageFailureKind) -> Bool {
    // A later operation-specific failure must not hide an already established broad outage.
    let resolved = resolveRecordingFailureKind(current: current, incoming: kind)
    let changed = current != resolved
    current = resolved
    if changed { failureGeneration &+= 1 }
    if resolved != .writeFailed { UserDefaults.standard.set(resolved.rawValue, forKey: key) }
    return changed && resolved != .writeFailed
  }

  private static func notifyOutage() {
    lock.lock(); let listener = outageListener; lock.unlock()
    if let listener { DispatchQueue.main.async(execute: listener) }
  }

  /// Reports a failed read without changing the recording gate or durable failure state.
  static func reportRead(operation: String, error: Error) {
    reporter.report(operation: operation, category: "query_failed", error: error)
    enterBroadOutage(error)
  }

  static func report(operation: String, category: String, error: Error) {
    reporter.report(operation: operation, category: category, error: error)
    enterBroadOutage(error)
  }

  private static func enterBroadOutage(_ error: Error) {
    let kind = classify(error)
    guard kind != .writeFailed else { return }
    lock.lock(); let changed = recordFailureLocked(kind: kind); lock.unlock()
    if changed { notifyOutage() }
  }

  static func classify(_ error: Error) -> RecordingStorageFailureKind {
    guard let dbError = error as? DatabaseError else { return .writeFailed }
    if dbError.resultCode == .SQLITE_FULL { return .fullDisk }
    if [.SQLITE_CANTOPEN, .SQLITE_CORRUPT, .SQLITE_IOERR, .SQLITE_NOTADB, .SQLITE_READONLY]
      .contains(dbError.resultCode) { return .storageUnavailable }
    return .writeFailed
  }
}
