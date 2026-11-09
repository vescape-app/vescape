import Foundation

/// Decides the cues of the joined Group Ride from the relay events `GroupRideObserver` feeds it.
/// Pure: it owns no timer, so the observer arms the `lostGraceMs` timer that ends in `graceElapsed()`.
///
/// The relay keeps a Rider whose socket closed in the roster as `away`, so going away and coming back
/// changes no id and plays nothing. A live Rider's id disappearing means a manual leave; an away
/// Rider's id disappearing is the relay expiring them (or their late leave) and plays nothing.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/GroupRideCues.kt `GroupRideCues`
struct GroupRideCues {
  /// How long our joined ride's link may stay down before `lost` plays. A rejoin inside it is
  /// silent, so a flapping connection does not chatter.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/GroupRideCues.kt `LOST_GRACE_MS`
  static let lostGraceMs: Int64 = 15_000

  private static let signalCuePrefix = "groupRide.signal."

  /// A Rider Signal cue: a safety call, so it plays even with connection sounds off.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/GroupRideCues.kt `isSignalCue`
  static func isSignalCue(_ cue: String) -> Bool { cue.hasPrefix(signalCuePrefix) }

  /// The ride the rider joined; `seen` and `members` belong to it. Kept through our own outage.
  private var rideId: String?
  /// Every other Rider id seen in `rideId`. Only an id outside it is a new Rider.
  private var seen: Set<String> = []
  /// Other Riders in the last roster of `rideId`.
  private var members: Set<String> = []
  /// The `members` that roster marked away.
  private var away: Set<String> = []
  /// Active signals of other Riders in the last roster of `rideId`, by rider id.
  private var signals: [String: RiderSignal] = [:]
  /// The next roster only catches up: the first after joining, or after our own link came back.
  private var syncing = true
  /// Our socket to `rideId` dropped and the rider has not rejoined yet.
  private var linkDown = false
  /// `lost` already played for the current outage.
  private var lostPlayed = false

  /// The relay confirmed the rider is in `rideId`. Another ride starts over with `joined`; the same
  /// ride after an outage is a rejoin, `restored` only when `lost` played for it.
  mutating func joined(_ rideId: String) -> String? {
    if rideId != self.rideId {
      reset()
      self.rideId = rideId
      return "groupRide.joined"
    }
    guard linkDown else { return nil }
    let cue = lostPlayed ? "groupRide.restored" : nil
    linkDown = false
    lostPlayed = false
    syncing = true
    return cue
  }

  /// Our socket dropped. True when this starts an outage of the joined ride: arm the grace timer.
  mutating func linkDropped() -> Bool {
    guard rideId != nil, !linkDown else { return false }
    linkDown = true
    return true
  }

  /// `lostGraceMs` passed since `linkDropped()`; `lost` once per outage still unresolved.
  mutating func graceElapsed() -> String? {
    guard linkDown, !lostPlayed else { return nil }
    lostPlayed = true
    return "groupRide.lost"
  }

  /// A roster of the joined ride, its `awayIds` the riders the relay marks away and `riderSignals`
  /// their active signals, `now` the relay's clock. A Rider Signal cue wins over social cues of the
  /// same roster: `groupRide.signal.<kind>` for a new or replaced signal (new `startedAt`), else
  /// `groupRide.signal.ok` for a still-present Rider whose signal is gone before its `expiresAt` by
  /// relay `now`. Expiry, a Rider leaving, and a missing `now` are silent. Social: `riderJoined` for
  /// an id never seen in this ride, else `riderLeft` when another Rider's id is gone and the previous
  /// roster had them live. The rider's own id never cues. Rosters of any other ride, or arriving
  /// while our link is down, are ignored; the first roster after joining or our own reconnect only
  /// catches up, so signals already active then stay silent.
  mutating func roster(
    rideId: String,
    riderIds: [String],
    awayIds: Set<String>,
    ownRiderId: String?,
    riderSignals: [String: RiderSignal] = [:],
    now: Int64? = nil
  ) -> String? {
    guard rideId == self.rideId, !linkDown else { return nil }
    let others = Set(riderIds.filter { $0 != ownRiderId })
    let arrived = others.subtracting(seen)
    let left = members.subtracting(others).subtracting(away)
    let current = riderSignals.filter { others.contains($0.key) }
    let raised = current.filter { signals[$0.key]?.startedAt != $0.value.startedAt }.map(\.value)
    let cleared = signals.contains { id, signal in
      guard let now else { return false }
      return others.contains(id) && current[id] == nil && now < signal.expiresAt
    }
    seen.formUnion(others)
    members = others
    away = awayIds.intersection(others)
    signals = current
    if syncing {
      syncing = false
      return nil
    }
    if let signal = raised.first(where: \.kind.critical) ?? raised.first {
      return Self.signalCuePrefix + signal.kind.rawValue
    }
    if cleared { return Self.signalCuePrefix + "ok" }
    if !arrived.isEmpty { return "groupRide.riderJoined" }
    if !left.isEmpty { return "groupRide.riderLeft" }
    return nil
  }

  /// The rider is no longer in the ride (left, stopped, blocked, ride ended): forget it all.
  mutating func reset() {
    rideId = nil
    seen = []
    members = []
    away = []
    signals = [:]
    syncing = true
    linkDown = false
    lostPlayed = false
  }
}
