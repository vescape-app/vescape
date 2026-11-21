import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/BoardPhase.kt
/// @parity /modules/vescape-core/src/index.ts `SessionStatus`
/// @platform-diff Android also exposes `stale` and `disconnecting`. iOS immediately routes stale
/// telemetry through `reconnecting`, and explicit stop transitions directly to `idle`/`error`
/// because there is no foreground-service teardown window to surface.
internal enum BoardPhase: String {
  case idle
  case connecting
  case discovering
  case subscribing
  case waitingForTelemetry = "waiting_for_telemetry"
  case connected
  case reconnecting
  case rescanning
  case error
}
