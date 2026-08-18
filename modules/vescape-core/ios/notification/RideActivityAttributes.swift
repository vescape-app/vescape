import ActivityKit
import AppIntents

/// Live Activity contract for the Board Session status surface. One activity lives for the whole
/// session; native updates its `ContentState` as the session moves through phases, battery steps,
/// and faults. Liveness is not part of the state: it rides ActivityKit's `staleDate`/`isStale`, so
/// a snapshot stranded by a killed process labels itself (ADR 0034).
///
/// This single file is compiled into BOTH the `vescape-core` module pod (which drives it via
/// `RideLiveActivityController`, globbed in by the podspec) and the `ride-activity` widget extension
/// (which renders it through the symlink under `targets/ride-activity`). ActivityKit matches the
/// two separately-compiled copies by unqualified type name.
///
/// The deployment target is iOS 17, matching the native Clerk SDK used by the app.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/notification/NotificationController.kt
/// @platform-diff Android's notification is a foreground-service keep-alive as well as UI; this
/// surface is render-only and grants the process no lifetime (see `RideLiveActivityController`).
struct RideActivityAttributes: ActivityAttributes {
  /// Dynamic session state, mutated in place for the life of the activity.
  struct ContentState: Codable, Hashable {
    /// Current board nickname. Lives in ContentState because ActivityKit attributes are immutable.
    var deviceName: String
    /// `BoardPhase` wire value (e.g. `connecting`, `connected`, `reconnecting`, `error`).
    var phase: String
    /// Primary human-readable status line (phase text, battery segment, or fault message).
    var statusText: String
    /// Compact glyph/percent for the Dynamic Island — mirrors Android's short-critical chip.
    var shortCritical: String
    /// Battery SoC Estimate percent for the progress bar, or `nil` before telemetry arrives.
    var batteryPercent: Int?
    /// Active fault code, or `nil` when the board reports no fault.
    var faultCode: Int?
  }

}

/// Native Stop ride action shared by the app and widget targets. `LiveActivityIntent` makes iOS run
/// `perform()` in the app process without foregrounding the UI, so the app-side copy can reach the
/// durable `BoardSessionController.shared`. The widget copy only supplies the archived intent type.
///
/// Authentication is deliberate: Lock Screen controls remain inert until the rider authenticates.
@available(iOS 17.0, *)
struct StopRideIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Stop ride"
  static let description = IntentDescription("Stop the active Vescape Board Session.")
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  func perform() async throws -> some IntentResult {
    #if canImport(ExpoModulesCore)
      await MainActor.run {
        BoardSessionCommands.stopRide()
      }
    #endif
    return .result()
  }
}
