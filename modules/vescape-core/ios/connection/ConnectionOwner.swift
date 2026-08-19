import Foundation

/// Who owns connection work, in the precedence order of ADR 0035. Explicit ownership, not a phase
/// string inferred after the fact: Android Auto Start (#407) and the alternative-Board hint (#408)
/// arbitrate against this enum.
///
/// `wireValue` is the trace vocabulary, so a decision logs the same word JS renders.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/ConnectionOwner.kt
/// @parity /src/modules/board/store/bleStore.ts `ConnectionOwner`
internal enum ConnectionOwner: CaseIterable {
  case boardSession
  case connectIntent
  case autoStart
  case autoConnect
  case alternativeHint
  /// Exclusive scanner owners. Outside the connection precedence chain — they cannot be preempted.
  case addBoardScan
  case boardProbe
  case none

  /// Scanner-exclusive owners sit outside the connection precedence chain.
  private static let exclusivePrecedence = -1

  var wireValue: String {
    switch self {
    case .boardSession: return ConnectionTraceOwner.boardSession
    case .connectIntent: return ConnectionTraceOwner.connectIntent
    case .autoStart: return ConnectionTraceOwner.autoStart
    case .autoConnect: return ConnectionTraceOwner.autoConnect
    case .alternativeHint: return ConnectionTraceOwner.alternativeHint
    case .addBoardScan: return ConnectionTraceOwner.addBoardScan
    case .boardProbe: return ConnectionTraceOwner.boardProbe
    case .none: return ConnectionTraceOwner.none
    }
  }

  var precedence: Int {
    switch self {
    case .boardSession: return 0
    case .connectIntent: return 1
    case .autoStart: return 2
    case .autoConnect: return 3
    case .alternativeHint: return 4
    case .addBoardScan, .boardProbe: return Self.exclusivePrecedence
    case .none: return Int.max
    }
  }

  var isExclusiveScannerOwner: Bool { self == .addBoardScan || self == .boardProbe }

  /// True when this owner may take work away from `other`. Exclusive owners never yield.
  func outranks(_ other: ConnectionOwner) -> Bool {
    if other == .none { return true }
    if other.isExclusiveScannerOwner { return false }
    if isExclusiveScannerOwner { return true }
    return precedence < other.precedence
  }

  static func fromWire(_ value: String?) -> ConnectionOwner {
    allCases.first { $0.wireValue == value } ?? .none
  }
}

/// Outcome of asking `ConnectionOwnership` for the connection.
internal struct OwnershipDecision {
  let granted: Bool
  let owner: ConnectionOwner
  let previousOwner: ConnectionOwner
  let reason: String?
}

/// Single source of truth for who currently owns connection work. Pure and synchronous so both the
/// Presence Scan and later Auto Start arbitration (#407) resolve against the same precedence rules
/// instead of guessing from phases.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/ConnectionOwner.kt `ConnectionOwnership`
internal final class ConnectionOwnership {
  /// Process-wide owner of connection work. Later slices arbitrate against this instance.
  static let shared = ConnectionOwnership()

  private let lock = NSLock()
  private var owner: ConnectionOwner = .none

  var current: ConnectionOwner {
    lock.lock()
    defer { lock.unlock() }
    return owner
  }

  @discardableResult
  func request(_ requested: ConnectionOwner) -> OwnershipDecision {
    lock.lock()
    defer { lock.unlock() }
    let previous = owner
    if previous == requested {
      return OwnershipDecision(granted: true, owner: requested, previousOwner: previous, reason: nil)
    }
    guard requested.outranks(previous) else {
      return OwnershipDecision(
        granted: false,
        owner: previous,
        previousOwner: previous,
        reason: Self.denialReason(previous)
      )
    }
    owner = requested
    return OwnershipDecision(granted: true, owner: requested, previousOwner: previous, reason: nil)
  }

  /// Release only if `released` still holds it, so a stale release cannot unseat a newer owner.
  @discardableResult
  func release(_ released: ConnectionOwner) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard owner == released else { return false }
    owner = .none
    return true
  }

  private static func denialReason(_ previous: ConnectionOwner) -> String {
    switch previous {
    case .boardSession: return ConnectionTraceReason.sessionAlreadyActive
    case .connectIntent: return ConnectionTraceReason.connectIntentActive
    case .addBoardScan, .boardProbe: return ConnectionTraceReason.scannerBusy
    default: return ConnectionTraceReason.higherPriorityOwner
    }
  }
}
