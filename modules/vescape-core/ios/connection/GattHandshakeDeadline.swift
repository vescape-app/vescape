import Foundation

/// Deadline, not a delay. A timeout grants the next handshake more time, independently of scan
/// cycles and radio connect attempts. Keep that allowance until telemetry proves recovery.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/GattHandshakeDeadline.kt
internal final class GattHandshakeDeadline {
  private(set) var timeoutMs: Int64 = 2_000

  func timedOut() {
    timeoutMs = min(timeoutMs + 2_000, 6_000)
  }

  func reset() {
    timeoutMs = 2_000
  }
}
