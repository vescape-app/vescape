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
    SentrySDK.capture(message: "Native operation failed") { scope in
      scope.setLevel(.error)
      scope.setFingerprint(["native", report.category, report.operation])
      scope.setTag(value: report.operation, key: "native.operation")
      scope.setTag(value: report.category, key: "native.category")
      scope.setExtra(value: report.errorType, key: "native.error_type")
      if let code = report.errorCode { scope.setExtra(value: code, key: "native.error_code") }
    }
#endif
  }

  static func report(operation: String, category: String, error: Error) {
    reporter.report(operation: operation, category: category, error: error)
  }
}
