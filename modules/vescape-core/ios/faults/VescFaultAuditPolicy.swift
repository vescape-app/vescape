import Foundation

/// Decides *when* it is safe and useful to ask the controller for its fault register.
///
/// Terminal reads compete with the response-paced telemetry loop, so they are deliberately rare:
/// an audit runs at a Board Session's start, immediately after a live fault trigger, once per stop
/// while the Board is standing still, and otherwise only on a slow idle fallback. Everything else
/// would spend BLE bandwidth to re-read bytes Vescape already has.
///
/// Pure and clock-driven: no scheduling, no BLE, no persistence. The Board Session feeds it observed
/// speed and asks what to do.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/faults/VescFaultAuditPolicy.kt
final class VescFaultAuditPolicy {
  /// Floor between any two reads within one session.
  static let minSpacingMs: Int64 = 60_000

  /// A session that never stops still audits this often.
  static let idleFallbackMs: Int64 = 15 * 60_000

  /// How long the Board must stand still before a stop counts as a safe audit opportunity.
  static let stationarySettleMs: Int64 = 5_000

  /// Above this speed the Board is moving, so a terminal read is not a safe opportunity.
  static let movingSpeedKmh = 1.0

  private let minSpacing: Int64
  private let idleFallback: Int64
  private let stationarySettle: Int64
  private let movingSpeed: Double

  private var lastAuditAtMs: Int64?
  private var stationarySinceMs: Int64?
  private var stationaryAudited = false

  init(
    minSpacingMs: Int64 = VescFaultAuditPolicy.minSpacingMs,
    idleFallbackMs: Int64 = VescFaultAuditPolicy.idleFallbackMs,
    stationarySettleMs: Int64 = VescFaultAuditPolicy.stationarySettleMs,
    movingSpeedKmh: Double = VescFaultAuditPolicy.movingSpeedKmh
  ) {
    self.minSpacing = minSpacingMs
    self.idleFallback = idleFallbackMs
    self.stationarySettle = stationarySettleMs
    self.movingSpeed = movingSpeedKmh
  }

  /// A read was just started for any reason: everything spaces itself off this moment.
  func onAuditStarted(_ nowMs: Int64) {
    lastAuditAtMs = nowMs
  }

  /// A new Board Session began. Nothing carries over; the connect audit is the session's first.
  func onSessionStarted() {
    lastAuditAtMs = nil
    stationarySinceMs = nil
    stationaryAudited = false
  }

  /// One decoded telemetry sample was observed.
  ///
  /// - Returns: the reason to audit now, or nil. Never returns a reason inside `minSpacingMs` of the
  ///   previous audit, so a stationary Board is not re-read every frame.
  func observe(_ nowMs: Int64, speedKmh: Double) -> VescFaultRegisterReason? {
    if speedKmh > movingSpeed {
      // Moving again: the next stop earns its own audit.
      stationarySinceMs = nil
      stationaryAudited = false
      return nil
    }
    let since = stationarySinceMs ?? nowMs
    stationarySinceMs = since
    guard spacingElapsed(nowMs) else { return nil }
    if !stationaryAudited, nowMs - since >= stationarySettle {
      stationaryAudited = true
      return .stationary
    }
    guard let last = lastAuditAtMs else { return nil }
    return nowMs - last >= idleFallback ? .idle : nil
  }

  private func spacingElapsed(_ nowMs: Int64) -> Bool {
    guard let last = lastAuditAtMs else { return true }
    return nowMs - last >= minSpacing
  }
}
