import ActivityKit
import AppIntents

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/notification/NotificationController.kt
/// @platform-diff Android's notification is a foreground-service keep-alive as well as UI; this
struct RideActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var deviceName: String
    var phase: String
    var statusText: String
    var shortCritical: String
    var batteryPercent: Int?
    var faultCode: Int?
    var noticeTitle: String? = nil
    var noticeSeverity: String? = nil
  }

}

@available(iOS 17.0, *)
struct StopRideIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Stop ride"
  static let description = IntentDescription("Stop the active Vescape Board Session.")
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  func perform() async throws -> some IntentResult {
    #if canImport(ExpoModulesCore)
      await BoardSessionCommands.stopRide()
    #endif
    return .result()
  }
}
