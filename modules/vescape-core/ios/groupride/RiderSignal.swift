import Foundation

/// The two pinned slots a Rider holds in a Group Ride, independently: one Rider Signal and one Ride
/// Hazard. The raw value is the relay's send message type (`<raw>-clear` clears) and roster field.
///
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

/// A fixed kind of pin, by its relay wire name.
internal protocol PinKind: Equatable {
  init?(rawValue: String)
  var rawValue: String { get }
  /// Titles Ride Notices.
  var label: String { get }
  static var slot: PinSlot { get }
}

/// The fixed **Rider Signal** kinds, by their relay wire name.
///
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

  /// Orders kinds when several cue at once: a serious injury over a minor injury or a board
  /// problem, those over a heads-up (a rider down after a small crash, a wait, a break).
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RiderSignal.kt `RiderSignalKind`
  /// @parity /src/modules/group-ride/constants/riderSignalKinds.ts `RIDER_SIGNAL_KIND_INFO`
  var rank: Int {
    switch self {
    case .serious: 2
    case .minor, .battery, .tire, .overheat, .board: 1
    case .down, .wait, .break: 0
    }
  }

  /// A serious injury is critical, a minor injury or a problem a warning, a rider down, a wait, or a break information.
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

/// The fixed **Ride Hazard** kinds, by their relay wire name.
///
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

/// A Rider's active pin as the relay stamps it. Times are relay epoch ms: compare them against the
/// roster's relay `now`, never the phone clock.
///
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

  /// Nil when absent, of an unknown kind, or missing a coordinate or time.
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

/// What the device knows when the Rider asks to send a signal. `fix` is the latest GPS fix no older
/// than `RiderSignals.fixMaxAgeMs`; `insidePrivacyZone` is also true while zones have not loaded.
/// A send ignores `insidePrivacyZone`: it is an explicit opt-in to share that spot (ADR-0020). The
/// flag only drives the picker's location warning.
///
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

  func frame() -> [String: Any] {
    switch self {
    case let .send(slot, kind, lat, lng): ["type": slot.rawValue, "kind": kind, "lat": lat, "lng": lng]
    case let .clear(slot): ["type": "\(slot.rawValue)-clear"]
    }
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RiderSignal.kt `RiderSignals`
internal enum RiderSignals {
  /// A send needs a GPS fix at most this old.
  static let fixMaxAgeMs: Int64 = 30_000

  /// The intent for a send request, or nil without a recent fix. Goes out inside a Privacy Zone and
  /// while zones are loading; presence keeps its own gates.
  static func sendIntent<Kind: PinKind>(_ kind: Kind, _ context: RiderSignalContext) -> RiderPinIntent? {
    guard let fix = context.fix else { return nil }
    return .send(slot: Kind.slot, kind: kind.rawValue, lat: fix.lat, lng: fix.lng)
  }
}
