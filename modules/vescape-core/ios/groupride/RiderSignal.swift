import Foundation

/// The fixed **Rider Signal** kinds, by their relay wire name.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RiderSignal.kt `RiderSignalKind`
/// @parity /src/modules/group-ride/constants/riderSignalKinds.ts `RIDER_SIGNAL_KINDS`
internal enum RiderSignalKind: String, CaseIterable {
  case board
  case battery
  case down
  case wait
  case help

  /// A call for help rather than a heads-up; it wins when several signals cue at once.
  var critical: Bool { self == .down || self == .help }
}

/// A Rider's active signal as the relay stamps it. Times are relay epoch ms: compare them against the
/// roster's relay `now`, never the phone clock.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RiderSignal.kt `RiderSignal`
/// @parity /modules/vescape-core/src/index.ts `GroupRideSignal`
internal struct RiderSignal: Equatable {
  let kind: RiderSignalKind
  let lat: Double
  let lng: Double
  let startedAt: Int64
  let expiresAt: Int64

  func toMap() -> [String: Any?] {
    ["kind": kind.rawValue, "lat": lat, "lng": lng, "startedAt": startedAt, "expiresAt": expiresAt]
  }

  /// Nil when absent, of an unknown kind, or missing a coordinate or time.
  static func parse(_ obj: [String: Any]?) -> RiderSignal? {
    guard let obj,
      let kind = (obj["kind"] as? String).flatMap(RiderSignalKind.init(rawValue:)),
      let lat = (obj["lat"] as? NSNumber)?.doubleValue, lat.isFinite,
      let lng = (obj["lng"] as? NSNumber)?.doubleValue, lng.isFinite,
      let startedAt = (obj["startedAt"] as? NSNumber)?.int64Value,
      let expiresAt = (obj["expiresAt"] as? NSNumber)?.int64Value
    else { return nil }
    return RiderSignal(kind: kind, lat: lat, lng: lng, startedAt: startedAt, expiresAt: expiresAt)
  }
}

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

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RiderSignal.kt `RiderSignalIntent`
internal enum RiderSignalIntent: Equatable {
  case send(kind: RiderSignalKind, lat: Double, lng: Double)
  case clear

  func frame() -> [String: Any] {
    switch self {
    case let .send(kind, lat, lng): ["type": "signal", "kind": kind.rawValue, "lat": lat, "lng": lng]
    case .clear: ["type": "signal-clear"]
    }
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RiderSignal.kt `RiderSignals`
internal enum RiderSignals {
  /// The relay feature advertised in `snapshot` when it accepts `signal`/`signal-clear`.
  static let relayFeature = "rider-signals"

  /// A send needs a GPS fix at most this old.
  static let fixMaxAgeMs: Int64 = 30_000

  /// The intent for a send request, or nil without a recent fix. Goes out inside a Privacy Zone and
  /// while zones are loading; presence keeps its own gates.
  static func sendIntent(_ kind: RiderSignalKind, _ context: RiderSignalContext) -> RiderSignalIntent? {
    guard let fix = context.fix else { return nil }
    return .send(kind: kind, lat: fix.lat, lng: fix.lng)
  }
}
