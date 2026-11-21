import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RiderSignal.kt `PinSlot`
internal enum PinSlot: String {
  case signal
  case hazard

  var relayFeature: String {
    switch self {
    case .signal: "rider-signals"
    case .hazard: "ride-hazards"
    }
  }
}

internal protocol PinKind: Equatable {
  init?(rawValue: String)
  var rawValue: String { get }
  var label: String { get }
  static var slot: PinSlot { get }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RiderSignal.kt `RiderSignalKind`
/// @parity /modules/vescape-core/src/index.ts `RIDER_SIGNAL_KINDS`
internal enum RiderSignalKind: String, CaseIterable, PinKind {
  case down
  case minor
  case serious
  case battery
  case tire
  case overheat
  case board
  case wait
  case `break`

  static let slot = PinSlot.signal

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RiderSignal.kt `RiderSignalKind`
  /// @parity /src/modules/group-ride/constants/riderSignalKinds.ts `RIDER_SIGNAL_KIND_INFO`
  var rank: Int {
    switch self {
    case .serious: 2
    case .minor, .battery, .tire, .overheat, .board: 1
    case .down, .wait, .break: 0
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RiderSignal.kt `severity`
  var severity: RideNoticeSeverity {
    switch rank {
    case 2: .critical
    case 1: .warning
    default: .info
    }
  }

  /// @parity /src/modules/group-ride/constants/riderSignalKinds.ts `RIDER_SIGNAL_KIND_INFO`
  var label: String {
    switch self {
    case .down: "Rider down"
    case .minor: "Minor injury"
    case .serious: "Serious injury"
    case .battery: "Battery dead"
    case .tire: "Flat tire"
    case .overheat: "Overheating"
    case .board: "Board fault"
    case .wait: "Wait for me"
    case .break: "Break"
    }
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RiderSignal.kt `RideHazardKind`
/// @parity /modules/vescape-core/src/index.ts `RIDE_HAZARD_KINDS`
internal enum RideHazardKind: String, CaseIterable, PinKind {
  case water
  case terrain
  case obstacle
  case police

  static let slot = PinSlot.hazard

  /// @parity /src/modules/group-ride/constants/riderSignalKinds.ts `RIDE_HAZARD_KIND_INFO`
  var label: String {
    switch self {
    case .water: "Water's edge"
    case .terrain: "Rough terrain"
    case .obstacle: "Obstacle"
    case .police: "Police"
    }
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RiderSignal.kt `RiderPin`
/// @parity /modules/vescape-core/src/index.ts `GroupRidePin`
internal struct RiderPin<Kind: PinKind>: Equatable {
  let kind: Kind
  let lat: Double
  let lng: Double
  let startedAt: Int64
  let expiresAt: Int64

  func toMap() -> [String: Any?] {
    ["kind": kind.rawValue, "lat": lat, "lng": lng, "startedAt": startedAt, "expiresAt": expiresAt]
  }

  static func parse(_ obj: [String: Any]?) -> RiderPin? {
    guard let obj,
      let kind = (obj["kind"] as? String).flatMap(Kind.init(rawValue:)),
      let lat = (obj["lat"] as? NSNumber)?.doubleValue, lat.isFinite,
      let lng = (obj["lng"] as? NSNumber)?.doubleValue, lng.isFinite,
      let startedAt = (obj["startedAt"] as? NSNumber)?.int64Value,
      let expiresAt = (obj["expiresAt"] as? NSNumber)?.int64Value
    else { return nil }
    return RiderPin(kind: kind, lat: lat, lng: lng, startedAt: startedAt, expiresAt: expiresAt)
  }
}

internal typealias RiderSignal = RiderPin<RiderSignalKind>
internal typealias RideHazard = RiderPin<RideHazardKind>

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RiderSignal.kt `RiderSignalContext`
internal struct RiderSignalContext {
  let fix: (lat: Double, lng: Double)?
  let insidePrivacyZone: Bool
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RiderSignal.kt `RiderPinIntent`
internal enum RiderPinIntent: Equatable {
  case send(slot: PinSlot, kind: String, lat: Double, lng: Double)
  case clear(PinSlot)

  var slot: PinSlot {
    switch self {
    case let .send(slot, _, _, _): slot
    case let .clear(slot): slot
    }
  }

  func frame(prefix: String = "") -> [String: Any] {
    switch self {
    case let .send(slot, kind, lat, lng): ["type": prefix + slot.rawValue, "kind": kind, "lat": lat, "lng": lng]
    case let .clear(slot): ["type": "\(prefix)\(slot.rawValue)-clear"]
    }
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RiderSignal.kt `RiderSignals`
internal enum RiderSignals {
  static let fixMaxAgeMs: Int64 = 30_000

  static func sendIntent<Kind: PinKind>(_ kind: Kind, _ context: RiderSignalContext) -> RiderPinIntent? {
    guard let fix = context.fix else { return nil }
    return .send(slot: Kind.slot, kind: kind.rawValue, lat: fix.lat, lng: fix.lng)
  }
}
