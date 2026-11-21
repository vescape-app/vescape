import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/diagnostics/DiagnosticsRecorder.kt
internal final class DiagnosticsRecorder {
  static let shared = DiagnosticsRecorder()

  private let store: TelemetryRepository

  init(store: TelemetryRepository = .shared) {
    self.store = store
  }

  func record(eventName: String, properties: [String: Any?] = [:]) {
    store.recordDiagnosticEvent(eventName: eventName, properties: properties)
  }
}
