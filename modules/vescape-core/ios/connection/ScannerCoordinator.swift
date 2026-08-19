import Foundation

/// Why the BLE scanner is running. One vocabulary for every scan in the app, so a callback can say
/// which operation it belongs to instead of the code guessing from surrounding state.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/ScannerCoordinator.kt `ScanPurpose`
/// @parity /modules/vescape-core/src/index.ts `ScanPurpose`
internal enum ScanPurpose: CaseIterable {
  /// Foreground-entry Board Presence Scan (ADR 0035). Yields to every exclusive owner.
  case presence
  /// Rider-driven Add Board discovery. Exclusive: never preempted.
  case addBoard
  /// Board Probe handshake during linking/setup. Exclusive: never preempted.
  case boardProbe
  /// Search backing an explicit Connect Intent.
  case connectIntent
  /// Mid-ride rediscovery of the Board Session's own peripheral.
  case reconnect

  var wireValue: String {
    switch self {
    case .presence: return "presence"
    case .addBoard: return "add_board"
    case .boardProbe: return "board_probe"
    case .connectIntent: return "connect_intent"
    case .reconnect: return "reconnect"
    }
  }

  var owner: ConnectionOwner {
    switch self {
    case .presence: return .autoConnect
    case .addBoard: return .addBoardScan
    case .boardProbe: return .boardProbe
    case .connectIntent: return .connectIntent
    case .reconnect: return .boardSession
    }
  }

  var isExclusive: Bool { owner.isExclusiveScannerOwner }

  static func fromWire(_ value: String?) -> ScanPurpose? {
    allCases.first { $0.wireValue == value }
  }
}

/// A granted scan, identified by its operation token.
internal struct ScanOperation: Equatable {
  let token: Int64
  let purpose: ScanPurpose
}

/// Result of asking `ScannerCoordinator` for the radio.
internal enum ScanAcquisition {
  case granted(ScanOperation)
  case denied(reason: String, heldBy: ScanPurpose?)
}

/// The one arbiter of BLE scanner ownership. Every scan takes a token; BLE scan callbacks outlive
/// their operation, so a callback that cannot prove it is `isCurrent` is dropped rather than allowed
/// to mutate state belonging to a newer scan.
///
/// Add Board scan and Board Probe hold the scanner exclusively and cannot be preempted — a Presence
/// Scan asking while either runs is denied with `scanner_busy`.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/ScannerCoordinator.kt
internal final class ScannerCoordinator {
  /// Process-wide arbiter. Add Board scan, Board Probe, reconnect, and Presence Scan share it.
  static let shared = ScannerCoordinator()

  private let lock = NSLock()
  private var tokens: Int64 = 0
  private var operation: ScanOperation?

  var active: ScanOperation? {
    lock.lock()
    defer { lock.unlock() }
    return operation
  }

  var activePurpose: ScanPurpose? { active?.purpose }

  func acquire(_ purpose: ScanPurpose) -> ScanAcquisition {
    lock.lock()
    defer { lock.unlock() }
    if let holder = operation, holder.purpose != purpose, !purpose.owner.outranks(holder.purpose.owner) {
      return .denied(reason: ConnectionTraceReason.scannerBusy, heldBy: holder.purpose)
    }
    tokens += 1
    let granted = ScanOperation(token: tokens, purpose: purpose)
    operation = granted
    return .granted(granted)
  }

  /// True only for the operation that still owns the scanner. Stale callbacks fail here.
  func isCurrent(_ candidate: ScanOperation?) -> Bool {
    guard let candidate else { return false }
    return active?.token == candidate.token
  }

  /// Release only if `candidate` still owns the scanner, so a late stop cannot kill a newer scan.
  @discardableResult
  func release(_ candidate: ScanOperation?) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard let candidate, operation?.token == candidate.token else { return false }
    operation = nil
    return true
  }
}
