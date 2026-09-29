import Foundation

/// About once a second: Rider Presence itself moves no faster (ADR-0039).
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrameBuilder.kt `GROUP_RIDE_FRAME_INTERVAL_MS`
let GROUP_RIDE_FRAME_INTERVAL_MS: Int64 = 1_000

/// Map span the wrist uses until the phone map has published its own. Same fallback as the route.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrameBuilder.kt `GROUP_RIDE_DEFAULT_SPAN_M`
let GROUP_RIDE_DEFAULT_SPAN_M = 600.0

/// Client-side presence ageing, the same rule the phone roster applies.
///
/// @parity /src/modules/group-ride/lib/roster.ts `RIDER_STALE_AFTER_MS`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrameBuilder.kt `GROUP_RIDE_STALE_AFTER_MS`
let GROUP_RIDE_STALE_AFTER_MS: Int64 = 5_000

/// @parity /src/modules/group-ride/lib/roster.ts `RIDER_DROP_AFTER_MS`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrameBuilder.kt `GROUP_RIDE_DROP_AFTER_MS`
let GROUP_RIDE_DROP_AFTER_MS: Int64 = 30_000

/// Fallback tints for a Rider who has not picked a colour, by their index in the phone roster.
///
/// @parity /src/modules/group-ride/lib/riderColor.ts `riderFallbackColors`
/// @parity /src/modules/group-ride/lib/roster.ts `riderRoster`
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrameBuilder.kt `GROUP_RIDE_FALLBACK_COLORS`
private let GROUP_RIDE_FALLBACK_COLORS: [UInt32] = [
  0xFF06_B6D4, // cyan
  0xFF22_C55E, // green
  0xFFF5_9E0B, // amber
  0xFFC0_84FC, // fuchsia
  0xFF38_BDF8, // sky
]

/// One roster entry as native keeps it for the wrist: the relay's `RiderView` reduced to what the
/// Group Ride Frame needs.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrameBuilder.kt `GroupRideRosterRider`
struct GroupRideRosterRider: Equatable {
  var id: String
  var name: String
  /// `#RRGGBB` as the Rider picked it, or nil.
  var color: String?
  /// Latest presence position; nil for a Rider who has not shared one yet.
  var position: WatchGeoPoint?
  var stale: Bool
  /// Relay wall-clock time of the Rider's last presence, epoch ms.
  var lastSeenMs: Int64
  /// Battery SoC Estimate as a 0-1 fraction; nil without a Board Session.
  var soc: Double? = nil
  var motorTempC: Double? = nil
  var ctrlTempC: Double? = nil
}

/// The joined Group Ride as native holds it: who the Rider is and everyone in the ride.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrameBuilder.kt `GroupRideRoster`
struct GroupRideRoster: Equatable {
  var ownRiderId: String?
  var riders: [GroupRideRosterRider]
}

/// Pure roster -> Group Ride Frame builder. Every other Rider with a position becomes an east/north
/// offset from the Rider's latest GPS Fix, nearest first; the Rider's own entry never does.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrameBuilder.kt `GroupRideFrameBuilder`
enum GroupRideFrameBuilder {
  static func build(
    roster: GroupRideRoster,
    own: WatchGeoPoint?,
    courseDeg: Double?,
    spanM: Double?,
    nowMs: Int64
  ) -> GroupRideFrame {
    let riders = own.map { place(roster: roster, own: $0, nowMs: nowMs) } ?? []
    let span = spanM.flatMap { $0.isFinite && $0 > 0 ? $0 : nil } ?? GROUP_RIDE_DEFAULT_SPAN_M
    return GroupRideFrame(courseDeg: courseDeg, spanM: span, riders: riders)
  }

  private struct Entry {
    let rider: GroupRideRosterRider
    let offset: (east: Double, north: Double)?
    let stale: Bool
    var distanceM: Double? { offset.map { ($0.east * $0.east + $0.north * $0.north).squareRoot() } }
  }

  private static func place(roster: GroupRideRoster, own: WatchGeoPoint, nowMs: Int64) -> [GroupRideFrameRider] {
    let fresh = roster.riders.filter { nowMs - $0.lastSeenMs < GROUP_RIDE_DROP_AFTER_MS }
    let entries = fresh
      .filter { $0.id != roster.ownRiderId }
      .map { rider in
        Entry(
          rider: rider,
          offset: rider.position.map { watchOffsetMeters(origin: own, point: $0) },
          stale: rider.stale || nowMs - rider.lastSeenMs >= GROUP_RIDE_STALE_AFTER_MS
        )
      }
      // The phone map's roster order, which is what its fallback tints are indexed by: fresh before
      // stale, nearest first, the unplaced last by name.
      .sorted { a, b in
        if a.stale != b.stale { return !a.stale }
        switch (a.distanceM, b.distanceM) {
        case let (x?, y?) where x != y: return x < y
        case (nil, _?): return false
        case (_?, nil): return true
        default: return a.rider.name < b.rider.name
        }
      }
    // The phone roster pins the Rider's own entry first, so everyone else's index starts after it.
    let first = fresh.contains { $0.id == roster.ownRiderId } ? 1 : 0
    let placed: [GroupRideFrameRider] = entries.enumerated().compactMap { index, entry in
      guard let offset = entry.offset else { return nil }
      return GroupRideFrameRider(
        id: entry.rider.id,
        name: entry.rider.name,
        colorArgb: parseRiderColor(entry.rider.color)
          ?? GROUP_RIDE_FALLBACK_COLORS[(first + index) % GROUP_RIDE_FALLBACK_COLORS.count],
        eastM: offset.east,
        northM: offset.north,
        stale: entry.stale,
        batteryPercent: entry.rider.soc.flatMap { $0.isFinite ? Int((min(max($0, 0), 1) * 100).rounded()) : nil },
        batteryLevel: TelemetryThresholds.batteryLevel(entry.rider.soc),
        heatLevel: TelemetryThresholds.heatLevel(motorTempC: entry.rider.motorTempC, ctrlTempC: entry.rider.ctrlTempC)
      )
    }
    return Array(placed.sorted { $0.distanceM < $1.distanceM }.prefix(GROUP_RIDE_FRAME_MAX_RIDERS))
  }

  /// `#RRGGBB` -> opaque ARGB; anything else is no colour.
  private static func parseRiderColor(_ color: String?) -> UInt32? {
    guard var hex = color else { return nil }
    if hex.hasPrefix("#") { hex.removeFirst() }
    guard hex.count == 6, let rgb = UInt32(hex, radix: 16) else { return nil }
    return 0xFF00_0000 | rgb
  }
}

/// The Group Ride Frame's own 1 Hz tick, beside the Watch Frame's `WatchTick` rather than inside it:
/// the two streams have their own sources and cadences (ADR-0039).
///
/// It pushes only while all three hold: the Watch Frame could be pushed at all (`canPushWatchFrame`),
/// the wrist says it is awake and not in ambient, and the Rider is joined (`frame` non-nil).
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/GroupRideFrameBuilder.kt `GroupRideFrameTick`
final class GroupRideFrameTick {
  private let scheduler: Scheduler
  private let canPushWatchFrame: () -> Bool
  private let wakeLevel: () -> WatchMirrorWakeLevel
  private let frame: () -> GroupRideFrame?
  private let push: (Data) -> Void
  private var handle: Cancellable?

  init(
    scheduler: Scheduler,
    canPushWatchFrame: @escaping () -> Bool,
    wakeLevel: @escaping () -> WatchMirrorWakeLevel,
    frame: @escaping () -> GroupRideFrame?,
    push: @escaping (Data) -> Void
  ) {
    self.scheduler = scheduler
    self.canPushWatchFrame = canPushWatchFrame
    self.wakeLevel = wakeLevel
    self.frame = frame
    self.push = push
  }

  func start() {
    if handle == nil { schedule() }
  }

  func stop() {
    handle?.cancel()
    handle = nil
  }

  private func schedule() {
    handle = scheduler.postDelayed(GROUP_RIDE_FRAME_INTERVAL_MS) { [weak self] in
      guard let self else { return }
      if self.wakeLevel() == .active, self.canPushWatchFrame(), let frame = self.frame() {
        self.push(GroupRideFrameCodec.encode(frame))
      }
      self.schedule()
    }
  }
}
