import Foundation

/// An explicit rider Connect. It outranks Android Auto Start and Auto Connect, and — when Auto Close
/// is disabled — keeps searching indefinitely (ADR 0035). #409 makes linking end in one of these.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/ConnectIntent.kt
internal struct ConnectIntent: Equatable {
  let boardId: String
  let createdAtMs: Int64
  /// Configured Auto Close window, or `nil` when Auto Close is disabled — then it never expires.
  let autoCloseMs: Int64?

  var owner: ConnectionOwner { .connectIntent }

  /// Absolute Auto Close deadline, or `nil` when the intent may persist indefinitely.
  var autoCloseAtMs: Int64? {
    guard let autoCloseMs else { return nil }
    return createdAtMs + autoCloseMs
  }
}

/// Every way an explicit Connect Intent ends. Each maps to one terminal trace reason.
internal enum ConnectIntentEnd {
  case disconnect
  case endRide
  case exit
  case forceQuit
  case connected
  case sessionTeardown
  case autoClose

  var reason: String {
    switch self {
    case .disconnect: return ConnectionTraceReason.manualDisconnect
    case .endRide: return ConnectionTraceReason.endRide
    case .exit: return ConnectionTraceReason.appExit
    case .forceQuit: return ConnectionTraceReason.taskRemoved
    case .connected: return ConnectionTraceReason.matched
    case .sessionTeardown: return ConnectionTraceReason.mechanicalTeardown
    case .autoClose: return ConnectionTraceReason.autoClose
    }
  }
}

/// Pure lifetime rules for `ConnectIntent`. Native holds the intent; this decides when it dies.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/ConnectIntent.kt `ConnectIntentPolicy`
internal enum ConnectIntentPolicy {
  /// Auto Close is the only clock-driven end. Disabled Auto Close ⇒ the intent never expires.
  static func isExpired(_ intent: ConnectIntent, nowMs: Int64) -> Bool {
    guard let deadline = intent.autoCloseAtMs else { return false }
    return nowMs >= deadline
  }

  /// An explicit Connect Intent outranks Auto Start, Auto Connect, and alternative hints.
  static func outranks(_ other: ConnectionOwner) -> Bool {
    ConnectionOwner.connectIntent.outranks(other)
  }

  /// An explicit Connect clears any Automatic Connection Pause on its Board (ADR 0035, #406).
  static func clearsPause() -> Bool { true }
}
