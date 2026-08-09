import Foundation

/// A rideable path from the rider to their Direction Point, following real ways. Computed once and
/// then fixed: nothing here recomputes, reroutes, or reacts to the rider moving.
///
/// It is a plain value with no behaviour on it, because a later slice shares it over Group Ride.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationController.kt `Navigation`
/// @parity /modules/vescape-core/src/index.ts `Navigation`
struct Navigation {
  let targetLatitude: Double
  let targetLongitude: Double
  let profile: String
  let computedAtMs: Int64
  /// Path points in encoding order, each `(latitude, longitude)`.
  let points: [(latitude: Double, longitude: Double)]

  func toMap() -> [String: Any] {
    [
      "target": ["latitude": targetLatitude, "longitude": targetLongitude],
      "profile": profile,
      "computedAtMs": computedAtMs,
      // GeoJSON order, which is what the JS `ShapeSource` expects — flipped from the pairs above.
      "coordinates": points.map { [$0.longitude, $0.latitude] },
    ]
  }
}

/// The one thing `NavigationController` needs from a routing service. A seam, so the controller's
/// ordering guarantees are testable without a network.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationController.kt `DirectionsRoutes`
protocol DirectionsRoutes {
  /// Path points as `(latitude, longitude)`, or `nil` when no route could be produced.
  func route(
    fromLatitude: Double,
    fromLongitude: Double,
    toLatitude: Double,
    toLongitude: Double,
    profile: String
  ) async -> [(latitude: Double, longitude: Double)]?
}

/// Owns the process's single Navigation. Setting a Direction Point asks for one; clearing the
/// Direction Point ends it. The two are strictly 1:1, so this holds at most one at a time.
///
/// **There is deliberately no rerouting.** No off-route detection, no recompute, no arrival
/// detection, no retry. EUC riders leave the line by hundreds of metres as a matter of course, and
/// a path that redraws itself under them is worse than a stale one. Only the rider replaces a
/// Navigation. Please do not add rerouting here.
///
/// In-memory only for now: it survives JS reloads but not a process restart. Persistence is a later
/// slice.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationController.kt
final class NavigationController {
  /// Process singleton — the Navigation must outlive JS runtime reloads.
  static let shared = NavigationController(
    api: MapboxDirectionsApi(accessToken: MapboxDirectionsApi.bakedAccessToken)
  )

  /// Navigation Profile selection is a later slice; until then every Navigation is walking.
  private static let defaultProfile = "walking"

  private let api: DirectionsRoutes
  private let lock = NSLock()

  private var state: Navigation?
  var current: Navigation? { lock.withLock { state } }

  /// Notified on every change, including the clear to `nil`.
  var onChange: ((Navigation?) -> Void)?

  /// Ordering token. Every intent claims one *synchronously*, before any network work starts, so
  /// the rider's last action always wins: a fetch that resolves late finds its token stale and is
  /// dropped rather than resurrecting a path over a newer target or over a clear.
  ///
  /// Claiming it inside the `Task` instead would order requests by whenever the runtime happened to
  /// schedule them, which is not the order the rider tapped in.
  private var generation = 0

  private func claimRequest() -> Int {
    lock.withLock {
      generation += 1
      return generation
    }
  }

  init(api: DirectionsRoutes) {
    self.api = api
  }

  /// Computes the Navigation to `toLatitude`/`toLongitude` from the rider's position. A missing
  /// rider position or a failed fetch yields no Navigation rather than a straight line.
  ///
  /// Returns immediately: the Directions call runs in its own `Task`, so callers never block the
  /// rider's tap on the network.
  func setTarget(
    toLatitude: Double,
    toLongitude: Double,
    fromLatitude: Double?,
    fromLongitude: Double?
  ) {
    let request = claimRequest()
    // The previous path led to the previous Direction Point, so it is already wrong. Drop it now
    // rather than leaving a stale line drawn under a pin that has visibly moved — a Navigation
    // belongs to exactly one Direction Point.
    publish(request, nil)
    guard let fromLatitude, let fromLongitude else { return }

    Task {
      let points = await api.route(
        fromLatitude: fromLatitude,
        fromLongitude: fromLongitude,
        toLatitude: toLatitude,
        toLongitude: toLongitude,
        profile: Self.defaultProfile
      )
      publish(
        request,
        points.map {
          Navigation(
            targetLatitude: toLatitude,
            targetLongitude: toLongitude,
            profile: Self.defaultProfile,
            computedAtMs: Int64(Date().timeIntervalSince1970 * 1000),
            points: $0
          )
        }
      )
    }
  }

  /// Clearing the Direction Point ends the Navigation; they are strictly 1:1.
  func clear() {
    publish(claimRequest(), nil)
  }

  /// Commits `navigation` if `request` is still the newest intent, and notifies in that same commit
  /// order. The staleness check, the write and the notify are one critical section: splitting them
  /// lets a stale result land after a newer one, leaving JS mirroring a path native no longer holds.
  ///
  /// `onChange` only hops to the main queue to emit and never calls back into this controller, so
  /// holding the lock across it cannot deadlock.
  private func publish(_ request: Int, _ navigation: Navigation?) {
    lock.withLock {
      guard request == generation, !isSame(state, navigation) else { return }
      state = navigation
      onChange?(navigation)
    }
  }

  /// `Navigation` holds a tuple array, which is not `Equatable`, so redundant no-op emits are
  /// filtered on the fields that identify one.
  private func isSame(_ a: Navigation?, _ b: Navigation?) -> Bool {
    switch (a, b) {
    case (nil, nil): return true
    case let (a?, b?):
      return a.computedAtMs == b.computedAtMs
        && a.targetLatitude == b.targetLatitude
        && a.targetLongitude == b.targetLongitude
    default: return false
    }
  }
}
