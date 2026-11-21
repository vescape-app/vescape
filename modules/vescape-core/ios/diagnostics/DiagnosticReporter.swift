import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/diagnostics/DiagnosticReporter.kt
internal final class DiagnosticReporter {
  static let shared = DiagnosticReporter()

  private let recorder: DiagnosticsRecorder
  private let lock = NSLock()
  private var captureCount = 0
  private var lastEventName: String?
  private var lastCaptureAt: Int64?

  init(recorder: DiagnosticsRecorder = .shared) {
    self.recorder = recorder
  }

  func capture(eventName: String, properties: [String: Any?] = [:]) {
    lock.lock()
    captureCount += 1
    lastEventName = eventName
    lastCaptureAt = Int64(Date().timeIntervalSince1970 * 1000.0)
    lock.unlock()
    recorder.record(eventName: eventName, properties: properties)
  }

  func status() -> [String: Any?] {
    lock.lock()
    defer { lock.unlock() }
    return [
      "captureCount": captureCount,
      "lastEventName": lastEventName,
      "lastCaptureAt": lastCaptureAt,
    ]
  }

  func reportUiError(message: String, source: String?, stack: String?) {
    capture(eventName: "ui_error", properties: [
      "operation": "ui",
      "message": message,
      "source": source,
      "stack": stack,
    ])
  }

  func reportDiagnosticTest() -> [String: Any?] {
    capture(eventName: "diagnostic_test", properties: [
      "operation": "dev_diagnostics",
      "source": "settings_dev",
      "message": "Manual diagnostic test",
    ])
    return status()
  }
}
