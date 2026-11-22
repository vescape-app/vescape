import Foundation

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
