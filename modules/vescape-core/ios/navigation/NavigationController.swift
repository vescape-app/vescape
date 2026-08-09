import Foundation

/// How a Navigation ended up. A Navigation exists for as long as its Direction Point does, so a
/// request that produced no path is still a Navigation — one that says why instead of drawing a
/// line. JS must never have to infer failure from an empty coordinate array.
///
/// The two failures are told apart because they are different rider situations, and will likely
/// want different copy: `fetchFailed` is worth retrying once the signal comes back, `noPathFound`
/// is not going to change by trying again from the same spot.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationController.kt `NavigationStatus`
/// @parity /modules/vescape-core/src/index.ts `NavigationStatus`
enum NavigationStatus: String {
  /// A usable path was computed and is in `points`.
  case ready
  /// Could not ask: no signal, timeout, HTTP error, missing token. `points` is empty.
  case fetchFailed
  /// Asked and answered, but nothing rideable leads there. `points` is empty.
  case noPathFound
}

/// The kind of ways a Navigation may follow. The rider picks it while looking at a path, and the
/// choice sticks as the default for the next one.
///
/// The raw values are Mapbox Directions profile names and go into the request path unchanged, so
/// they are a contract with the routing service as much as with JS.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationController.kt `NavigationProfile`
/// @parity /modules/vescape-core/src/index.ts `NavigationProfile`
enum NavigationProfile: String {
  /// Reaches footpaths and forest tracks, which is where Direction Points usually are.
  case walking
  /// Cycleways and roads; refuses footpaths.
  case cycling
  /// Roads only.
  case driving

  /// What a rider who has never chosen gets. `cycling` would refuse footpaths and hit the no-path
  /// state constantly, so the widest-reaching profile leads.
  static let `default` = NavigationProfile.walking

  static func fromWire(_ wire: String?) -> NavigationProfile {
    wire.flatMap(NavigationProfile.init(rawValue:)) ?? .default
  }
}

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
  /// The Navigation Profile this path was produced under; it never changes for this Navigation.
  let profile: NavigationProfile
  let computedAtMs: Int64
  let status: NavigationStatus
  /// Path points in encoding order, each `(latitude, longitude)`. Empty unless `status` is `ready`.
  let points: [(latitude: Double, longitude: Double)]

  func toMap() -> [String: Any] {
    [
      "target": ["latitude": targetLatitude, "longitude": targetLongitude],
      "profile": profile.rawValue,
      "computedAtMs": computedAtMs,
      "status": status.rawValue,
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
  func route(
    fromLatitude: Double,
    fromLongitude: Double,
    toLatitude: Double,
    toLongitude: Double,
    profile: String
  ) async -> DirectionsResult
}

/// What one Directions call produced. "Could not ask" and "asked, nothing leads there" are separate
/// cases all the way down, because the rider's options differ: one is worth retrying, the other is
/// the honest answer for that pin.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationController.kt `DirectionsResult`
enum DirectionsResult {
  /// Path points as `(latitude, longitude)`.
  case path([(latitude: Double, longitude: Double)])
  /// The service answered, but returned nothing rideable.
  case noPath
  /// The service could not be reached or asked at all.
  case failed
}

/// Owns the process's single Navigation. Setting a Direction Point asks for one; clearing the
/// Direction Point ends it. The two are strictly 1:1, so this holds at most one at a time.
///
/// **There is deliberately no rerouting.** No off-route detection, no arrival detection, no
/// automatic retry — not in the foreground and not in the background. EUC riders leave the line by
/// hundreds of metres as a matter of course, and a path that redraws itself under them is worse
/// than a stale one. A failed Navigation stays failed until the rider asks again, which is a
/// `recompute` call made from a rider's tap. Only the rider replaces a Navigation. Please do not
/// add rerouting here.
///
/// Durable: every change is written through to `NavigationStore`, and `restore()` brings the stored
/// path back on cold start. Restoring is a read, never a fetch — the stored path is the truth
/// however old it is, so a path computed last weekend is still the path.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationController.kt
final class NavigationController {
  /// Process singleton — the Navigation must outlive JS runtime reloads.
  static let shared: NavigationController = {
    let controller = NavigationController(
      api: MapboxDirectionsApi(accessToken: MapboxDirectionsApi.bakedAccessToken),
      store: AppDataNavigationStore()
    )
    // Restore here rather than from the module, so a JS reload — which recreates the module but not
    // this singleton — cannot re-run it over a Navigation the rider has since replaced.
    controller.restore()
    return controller
  }()

  private let api: DirectionsRoutes
  private let store: NavigationStore
  private let lock = NSLock()

  private var state: Navigation?
  var current: Navigation? { lock.withLock { state } }

  /// The Navigation Profile the next computed path will use — the rider's last choice, cached here
  /// so `setTarget` can read it without waiting on a database. Seeded from the store by `restore`.
  ///
  /// It is not the profile of the drawn path: a recompute that failed leaves the old path drawn
  /// under a newer choice, and the path keeps carrying the profile that actually produced it.
  private var profile: NavigationProfile = .default

  /// The Navigation Profile the next computed path will use.
  var currentProfile: NavigationProfile { lock.withLock { profile } }

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

  init(api: DirectionsRoutes, store: NavigationStore) {
    self.api = api
    self.store = store
  }

  /// Cold start: brings the stored Navigation back, without touching the network.
  ///
  /// Claims a token like any other intent, so a rider who taps a new Direction Point while the read
  /// is still in flight wins over the restore rather than being overwritten by yesterday's path.
  ///
  /// Returns immediately; the read runs in its own `Task`.
  func restore() {
    let request = claimRequest()
    Task {
      if let stored = await store.loadProfile() { lock.withLock { profile = stored } }
      guard let stored = await store.load() else { return }
      let directionPoint = await store.directionPoint()
      // The two are written separately, so an interrupted write can leave a path leading somewhere
      // the rider is no longer heading. Drawing a line to the wrong place is worse than drawing none.
      let matchesDirectionPoint = stored.targetLatitude == directionPoint?.latitude
        && stored.targetLongitude == directionPoint?.longitude
      let usable = matchesDirectionPoint ? stored : nil
      publish(request, usable)
      // `publish(nil)` changed nothing here — nothing had been published yet — so the disagreeing
      // row has to be dropped explicitly, or every later start would re-read and re-reject it.
      if usable == nil { persist(request) }
    }
  }

  /// Computes the Navigation to `toLatitude`/`toLongitude` from the rider's position. A missing
  /// rider position, a failed fetch or a path nothing could ride yields a Navigation carrying the
  /// reason rather than a straight line — see `NavigationStatus`.
  ///
  /// Uses the rider's sticky Navigation Profile. Asking for the same target again is `recompute`,
  /// which keeps a working path when the new request fails; this one always replaces, because the
  /// target moved and the old path is already wrong.
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

    // No fix yet is a "could not ask", not a "nothing leads there": the rider is told, and asking
    // again once the phone has a position is exactly what `recompute` does.
    guard let fromLatitude, let fromLongitude else {
      publish(request, failed(toLatitude, toLongitude, currentProfile, .fetchFailed))
      return
    }

    let requested = currentProfile
    Task {
      let navigation = await compute(
        toLatitude, toLongitude, fromLatitude, fromLongitude, requested
      )
      publish(request, navigation)
    }
  }

  /// Remembers `next` as the rider's Navigation Profile without touching the current path.
  /// Switching profile is `selectProfile` followed by `recompute`; on its own this only moves the
  /// default the next Navigation will be computed under.
  ///
  /// The choice is stored even when the recompute that follows it fails: the rider chose it, and
  /// "last choice wins" is about the choice, not about whether that one request found a path.
  func selectProfile(_ next: NavigationProfile) {
    let changed: Bool = lock.withLock {
      guard profile != next else { return false }
      profile = next
      return true
    }
    guard changed else { return }
    Task { await store.saveProfile(next) }
  }

  /// The rider asking for a fresh path to the Direction Point they already have, from where they
  /// are now. This is the *only* way a Navigation is replaced once computed — nothing may call it
  /// on a timer, on reconnect or on a new fix.
  ///
  /// Unlike `setTarget` it does not drop the current path first, and a request that produces no
  /// path is discarded while a usable one is already drawn: losing a working line by asking for a
  /// better one is a bad trade. The rider is told nothing changed by the line simply staying put.
  func recompute(
    toLatitude: Double,
    toLongitude: Double,
    fromLatitude: Double?,
    fromLongitude: Double?
  ) {
    let request = claimRequest()
    let requested = currentProfile

    guard let fromLatitude, let fromLongitude else {
      publish(
        request, failed(toLatitude, toLongitude, requested, .fetchFailed), keepUsablePath: true
      )
      return
    }

    Task {
      let navigation = await compute(
        toLatitude, toLongitude, fromLatitude, fromLongitude, requested
      )
      publish(request, navigation, keepUsablePath: true)
    }
  }

  private func compute(
    _ toLatitude: Double,
    _ toLongitude: Double,
    _ fromLatitude: Double,
    _ fromLongitude: Double,
    _ profile: NavigationProfile
  ) async -> Navigation {
    let result = await api.route(
      fromLatitude: fromLatitude,
      fromLongitude: fromLongitude,
      toLatitude: toLatitude,
      toLongitude: toLongitude,
      profile: profile.rawValue
    )
    switch result {
    case .failed:
      return failed(toLatitude, toLongitude, profile, .fetchFailed)
    case .noPath:
      return failed(toLatitude, toLongitude, profile, .noPathFound)
    case let .path(points):
      return NavigationUsability.isUsable(
        points, targetLatitude: toLatitude, targetLongitude: toLongitude
      )
        ? Navigation(
          targetLatitude: toLatitude,
          targetLongitude: toLongitude,
          profile: profile,
          computedAtMs: Int64(Date().timeIntervalSince1970 * 1000),
          status: .ready,
          points: points
        )
        : failed(toLatitude, toLongitude, profile, .noPathFound)
    }
  }

  private func failed(
    _ toLatitude: Double,
    _ toLongitude: Double,
    _ profile: NavigationProfile,
    _ status: NavigationStatus
  ) -> Navigation {
    Navigation(
      targetLatitude: toLatitude,
      targetLongitude: toLongitude,
      profile: profile,
      computedAtMs: Int64(Date().timeIntervalSince1970 * 1000),
      status: status,
      points: []
    )
  }

  /// Clearing the Direction Point ends the Navigation; they are strictly 1:1.
  func clear() {
    publish(claimRequest(), nil)
  }

  /// Commits `navigation` if `request` is still the newest intent — and, when `keepUsablePath` is
  /// set, only if it is not a downgrade from a drawn path to a failure — and notifies in that same
  /// commit order. The staleness check, the write and the notify are one critical section: splitting them
  /// lets a stale result land after a newer one, leaving JS mirroring a path native no longer holds.
  ///
  /// `onChange` only hops to the main queue to emit and never calls back into this controller, so
  /// holding the lock across it cannot deadlock.
  private func publish(_ request: Int, _ navigation: Navigation?, keepUsablePath: Bool = false) {
    let committed: Bool = lock.withLock {
      guard request == generation, !isSame(state, navigation) else { return false }
      // A recompute that found nothing must not take away a path the rider can still ride. Checked
      // in here rather than at the call site so the read of `state` and the write are one step.
      if keepUsablePath, navigation?.status != .ready, state?.status == .ready { return false }
      state = navigation
      onChange?(navigation)
      return true
    }
    if committed { persist(request) }
  }

  /// Writes whatever is current through to the store, off the caller's thread.
  ///
  /// It deliberately re-reads `state` instead of taking a value: writes are not ordered against each
  /// other, so a write that carried its own stale value could land last and leave storage
  /// disagreeing with what native holds. Re-reading makes every write converge on the newest state.
  private func persist(_ request: Int) {
    Task {
      let navigation: Navigation?? = lock.withLock { request == generation ? .some(state) : nil }
      guard let navigation else { return }
      await store.save(navigation)
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
        && a.status == b.status
    default: return false
    }
  }
}
