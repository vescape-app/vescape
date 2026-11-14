import Foundation

/// Builds the Live Activity `ContentState` from the current Board Session snapshot. Kept separate
/// from delivery (`RideLiveActivityController`) so the phrasing can be unit-tested and stays aligned
/// with Android's notification wording.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/notification/NotificationFormatter.kt
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardPhase.kt
enum RideActivityContent {
  static func state(
    deviceName: String?,
    phase: BoardPhase,
    batteryPercent: Int?,
    batteryVoltage: Double?,
    faultCode: Int?,
    notice: RideNoticeContent? = nil
  ) -> RideActivityAttributes.ContentState {
    RideActivityAttributes.ContentState(
      deviceName: boardLabel(deviceName),
      phase: phase.rawValue,
      statusText: statusText(
        phase: phase, batteryPercent: batteryPercent, batteryVoltage: batteryVoltage, faultCode: faultCode),
      shortCritical: shortCritical(
        phase: phase, batteryPercent: batteryPercent, batteryVoltage: batteryVoltage, faultCode: faultCode),
      batteryPercent: batteryPercent,
      faultCode: faultCode,
      noticeTitle: notice?.title,
      noticeSeverity: notice?.severity.rawValue
    )
  }

  static func boardLabel(_ deviceName: String?) -> String {
    guard let deviceName, !deviceName.isEmpty else { return "VESC" }
    return deviceName
  }

  /// Primary status line. A fault takes precedence, then the battery segment once connected,
  /// otherwise the phase label. Mirrors Android `resolveText` + `displayText`.
  static func statusText(
    phase: BoardPhase, batteryPercent: Int?, batteryVoltage: Double?, faultCode: Int?
  ) -> String {
    if let faultCode {
      return faultCode > 0 ? "Fault detected (code \(faultCode))" : "Fault detected"
    }
    if phase == .connected, let segment = batterySegment(percent: batteryPercent, voltage: batteryVoltage) {
      return segment
    }
    return displayText(phase)
  }

  /// Battery segment `"45% (75.1V)"`, or just `"75.1V"` when the SoC percent is unavailable (no
  /// board `batteryConfig`). Mirrors Android `NotificationFormatter.formatBatterySegment`; the
  /// voltage is formatted through the shared `battery` metric def (1 decimal + `V`). Returns nil only
  /// before any telemetry (no voltage yet), so the caller falls back to the phase label.
  static func batterySegment(percent: Int?, voltage: Double?) -> String? {
    guard let voltage else { return percent.map { "\($0)%" } }
    let volts = formatAlertValue(voltage, "battery") + alertControlUnit("battery")
    if let percent { return "\(percent)% (\(volts))" }
    return volts
  }

  /// Compact glyph/percent for the Dynamic Island. Mirrors Android `shortCriticalSymbol` +
  /// `formatShortCriticalText` — percent when available, else voltage, once connected.
  static func shortCritical(
    phase: BoardPhase, batteryPercent: Int?, batteryVoltage: Double?, faultCode: Int?
  ) -> String {
    if faultCode != nil { return "⚠" }
    switch phase {
    case .idle: return "—"
    case .connected:
      if let batteryPercent { return "\(batteryPercent)%" }
      if let batteryVoltage { return formatAlertValue(batteryVoltage, "battery") + alertControlUnit("battery") }
      return "—"
    case .error: return "✕"
    case .connecting, .discovering, .subscribing, .waitingForTelemetry, .reconnecting, .rescanning:
      return "…"
    }
  }

  /// Phase label copy. Mirrors Android `BoardPhase.displayText`.
  static func displayText(_ phase: BoardPhase) -> String {
    switch phase {
    case .idle: return "Board not connected"
    case .connecting: return "Connecting…"
    case .discovering: return "Discovering…"
    case .subscribing: return "Subscribing…"
    case .waitingForTelemetry: return "Waiting for telemetry…"
    case .connected: return "Connected"
    case .reconnecting: return "Reconnecting…"
    case .rescanning: return "Searching…"
    case .error: return "Connection error"
    }
  }
}
