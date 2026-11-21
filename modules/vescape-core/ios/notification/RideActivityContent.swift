import Foundation

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

  static func batterySegment(percent: Int?, voltage: Double?) -> String? {
    guard let voltage else { return percent.map { "\($0)%" } }
    let volts = formatAlertValue(voltage, "battery") + alertControlUnit("battery")
    if let percent { return "\(percent)% (\(volts))" }
    return volts
  }

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
