import Foundation

/// Local-only capture of Local Diagnostic Events (ADR 0007). Thin seam over the telemetry store
/// so callers (alert engine, Board Probe #111, bridge diagnostics) share one entry point and
/// one sanitize/persist path. Debug-facing breadcrumbs, not user-visible Ride History Markers.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/diagnostics/DiagnosticsRecorder.kt
internal final class DiagnosticsRecorder {
  static let shared = DiagnosticsRecorder()

  private let store: TelemetryRepository

  init(store: TelemetryRepository = .shared) {
    self.store = store
  }

  /// Persist one event. The event-type set is kept in sync with Android — connection/telemetry
  /// breadcrumbs, alert diagnostics, `ui_error`/`diagnostic_test`, and the Board Probe
  /// `board_probe_*` family (emitted once #111 lands). The removed `can_ping_*` events (PR #108 /
  /// ADR 0015) are intentionally absent.
  func record(eventName: String, properties: [String: Any?] = [:]) {
    store.recordDiagnosticEvent(eventName: eventName, properties: properties)
  }
}
