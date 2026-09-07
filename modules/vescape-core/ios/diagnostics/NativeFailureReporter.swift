import Foundation
#if canImport(Sentry)
import Sentry
#endif

internal struct NativeFailureReport: Equatable {
  let operation: String
  let category: String
  let errorType: String
  let errorCode: Int?
}

/// Process-scoped, operation-keyed deduplication shared by persistence and other native failures.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/diagnostics/NativeFailureReporter.kt
internal final class NativeFailureReporter {
  private let lock = NSLock()
  private var reported: Set<String> = []
  private let sink: (NativeFailureReport) -> Void

  init(sink: @escaping (NativeFailureReport) -> Void) { self.sink = sink }

  func report(operation: String, category: String, error: Error) {
    lock.lock()
    let inserted = reported.insert(operation).inserted
    lock.unlock()
    guard inserted else { return }
    let nsError = error as NSError
    sink(.init(
      operation: operation,
      category: category,
      errorType: String(describing: type(of: error)),
      errorCode: nsError.code
    ))
  }
}

internal enum UnexpectedNativeError {
  private static let reporter = NativeFailureReporter { report in
#if canImport(Sentry)
    let event = Event(level: .error)
    event.message = SentryMessage(formatted: "Native operation failed")
    event.fingerprint = ["native", report.category, report.operation]
    event.tags = ["native.operation": report.operation, "native.category": report.category]
    event.extra = ["native.error_type": report.errorType]
    if let code = report.errorCode { event.extra?["native.error_code"] = code }
    SentrySDK.capture(event: event)
#endif
  }

  static func report(operation: String, category: String, error: Error) {
    reporter.report(operation: operation, category: category, error: error)
  }
}
