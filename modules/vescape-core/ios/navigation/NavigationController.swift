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

  private let api: MapboxDirectionsApi
  private let lock = NSLock()

  private var _current: Navigation?
  var current: Navigation? { lock.withLock { _current } }

  /// Notified on every change, including the clear to `nil`.
  var onChange: ((Navigation?) -> Void)?

  /// Requests generate a token so a slower earlier fetch cannot overwrite a newer Direction Point —
  /// the rider tapping twice in a second must end up with the second path, not whichever call the
  /// network happened to finish last.
  private var _generation = 0
  private func nextGeneration() -> Int {
    lock.withLock {
      _generation += 1
      return _generation
    }
  }

  init(api: MapboxDirectionsApi) {
    self.api = api
  }

  /// Computes the Navigation to `toLatitude`/`toLongitude` from the rider's position. A missing
  /// rider position or a failed fetch yields no Navigation rather than a straight line.
  func setTarget(
    toLatitude: Double,
    toLongitude: Double,
    fromLatitude: Double?,
    fromLongitude: Double?
  ) async {
    let request = nextGeneration()
    guard let fromLatitude, let fromLongitude else {
      publish(request, nil)
      return
    }

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

  /// Clearing the Direction Point ends the Navigation; they are strictly 1:1.
  func clear() {
    publish(nextGeneration(), nil)
  }

  private func publish(_ request: Int, _ navigation: Navigation?) {
    let accepted: Bool = lock.withLock {
      guard request == _generation else { return false }
      _current = navigation
      return true
    }
    guard accepted else { return }
    onChange?(navigation)
  }
}
