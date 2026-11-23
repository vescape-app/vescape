import Foundation

struct BoardRideState: Equatable {
  let state: Int
  let switchState: Int
  let receivedAtMs: Int64
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/BoardIdleGate.kt
enum BoardIdleGate {
  private static let handtestSwitchBit = 0x08
  private static let telemetryMaxAgeMs: Int64 = 4_000

  static func freshSinceMs(_ referenceMs: Int64) -> Int64 { referenceMs - telemetryMaxAgeMs }

  static func blockReason(_ rideState: BoardRideState?, freshSinceMs: Int64) -> String? {
    guard let rideState, rideState.receivedAtMs >= freshSinceMs else {
      return "No fresh telemetry shows the board idle"
    }
    if isRefloatEngaged(state: rideState.state) { return "Board is engaged (state \(rideState.state))" }
    if rideState.switchState & handtestSwitchBit != 0 { return "Board is in handtest" }
    return nil
  }
}
