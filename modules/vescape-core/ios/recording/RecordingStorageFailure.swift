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

internal struct RecordingFailureReport: Equatable {
  let operation: String
  let category: String
  let errorType: String
}

internal final class RecordingFailureReporter {
  private let lock = NSLock()
  private var reported = false
  private let sink: (RecordingFailureReport) -> Void

  init(sink: @escaping (RecordingFailureReport) -> Void) { self.sink = sink }

  func report(kind: RecordingStorageFailureKind, error: Error) {
    lock.lock(); defer { lock.unlock() }
    guard !reported else { return }
    reported = true
    sink(.init(operation: "recording_commit", category: kind.rawValue, errorType: String(describing: type(of: error))))
  }
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
  private static let reporter = RecordingFailureReporter { report in
#if canImport(Sentry)
    SentrySDK.capture(message: "Ride Recording persistence failed") { scope in
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

  static func startupCheck(_ check: () throws -> Void) {
    lock.lock(); defer { lock.unlock() }
    guard !startupChecked else { return }
    startupChecked = true
    do {
      try check()
      UserDefaults.standard.removeObject(forKey: key)
      current = nil
    } catch {
      let classified = classify(error)
      recordFailure(error, kind: classified == .writeFailed ? .storageUnavailable : classified)
    }
  }

  static func value() -> RecordingStorageFailureKind? {
    lock.lock(); defer { lock.unlock() }
    return current
  }

  @discardableResult static func fail(_ error: Error) -> RecordingStorageFailureKind {
    lock.lock(); defer { lock.unlock() }
    let kind = classify(error)
    return recordFailure(error, kind: kind)
  }

  @discardableResult private static func recordFailure(
    _ error: Error, kind: RecordingStorageFailureKind
  ) -> RecordingStorageFailureKind {
    // A later operation-specific failure must not hide an already established broad outage.
    let resolved = resolveRecordingFailureKind(current: current, incoming: kind)
    current = resolved
    if resolved != .writeFailed { UserDefaults.standard.set(resolved.rawValue, forKey: key) }
    reporter.report(kind: resolved, error: error)
    return resolved
  }

  static func classify(_ error: Error) -> RecordingStorageFailureKind {
    guard let dbError = error as? DatabaseError else { return .writeFailed }
    if dbError.resultCode == .SQLITE_FULL { return .fullDisk }
    if [.SQLITE_CANTOPEN, .SQLITE_CORRUPT, .SQLITE_IOERR, .SQLITE_NOTADB, .SQLITE_READONLY]
      .contains(dbError.resultCode) { return .storageUnavailable }
    return .writeFailed
  }
}
