import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationController.kt `NavigationStatus`
/// @parity /modules/vescape-core/src/index.ts `NavigationStatus`
enum NavigationStatus: String {
  case ready
  case fetchFailed
  case noPathFound
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationController.kt `NavigationProfile`
/// @parity /modules/vescape-core/src/index.ts `NavigationProfile`
enum NavigationProfile: String {
  case walking
  case cycling
  case driving

  static let `default` = NavigationProfile.walking

  static func fromWire(_ wire: String?) -> NavigationProfile {
    wire.flatMap(NavigationProfile.init(rawValue:)) ?? .default
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationController.kt `Navigation`
/// @parity /modules/vescape-core/src/index.ts `Navigation`
struct Navigation {
  let targetLatitude: Double
  let targetLongitude: Double
  let profile: NavigationProfile
  let computedAtMs: Int64
  let status: NavigationStatus
  let distanceMeters: Double
  let durationSeconds: Double
  let points: [(latitude: Double, longitude: Double)]
  var revision: Int64 = 0
  var automatic = false

  func toMap() -> [String: Any] {
    [
      "target": ["latitude": targetLatitude, "longitude": targetLongitude],
      "profile": profile.rawValue,
      "computedAtMs": computedAtMs,
      "revision": revision,
      "automatic": automatic,
      "status": status.rawValue,
      "distanceMeters": distanceMeters,
      "durationSeconds": durationSeconds,
      "coordinates": points.map { [$0.longitude, $0.latitude] },
    ]
  }
}

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

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationController.kt `DirectionsResult`
enum DirectionsResult {
  case path(
    points: [(latitude: Double, longitude: Double)],
    distanceMeters: Double,
    durationSeconds: Double
  )
  case noPath
  case failed
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationController.kt
final class NavigationController {
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/RerouteDistance.kt
  /// @parity /modules/vescape-core/src/index.ts `NAVIGATION_REROUTE_DISTANCE`
  static let defaultRerouteDistanceMeters = 50.0
  static let rerouteDistanceRange = 1.0...1000.0
  private static let automaticMinBackoffMs = 30_000.0
  private static let automaticMaxBackoffMs = 300_000.0

  static let shared: NavigationController = {
    let controller = NavigationController(
      api: MapboxDirectionsApi(api: VescapeApi.forOrigin(AppStatusCoordinator.serverBaseUrl)),
      store: AppDataNavigationStore(),
      loadRerouteDistanceMeters: {
        do {
          return try AppDataRepository.shared.getSettings()["navigationRerouteDistanceMeters"] as? Double
            ?? defaultRerouteDistanceMeters
        } catch {
          RecordingStorageFailure.reportRead(operation: "navigation_threshold_read", error: error)
          return defaultRerouteDistanceMeters
        }
      }
    )
    controller.restore()
    return controller
  }()

  private let api: DirectionsRoutes
  private let store: NavigationStore
  private let loadRerouteDistanceMeters: () async -> Double
  private let nowMillis: () -> Double
  private let lock = NSLock()

  private var revision: Int64 = 0
  private var state: Navigation?
  var current: Navigation? { lock.withLock { state } }

  private var profile: NavigationProfile = .default

  private var profileChosen = false

  private let writes = SerialWrites()

  var currentProfile: NavigationProfile { lock.withLock { profile } }

  private var computingRequest: Int?

  var computing: Bool { lock.withLock { computingRequest != nil } }

  var onChange: ((Navigation?) -> Void)?

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationController.kt `onWatchChange`
  var onWatchChange: (() -> Void)?

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationController.kt `onPathChange`
  var onPathChange: (([(latitude: Double, longitude: Double)]?) -> Void)?

  var currentPath: [(latitude: Double, longitude: Double)]? { lock.withLock { ridePath(state) } }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationController.kt `ridePath`
  private func ridePath(_ navigation: Navigation?) -> [(latitude: Double, longitude: Double)]? {
    guard let navigation, navigation.status == .ready, !navigation.points.isEmpty else { return nil }
    return navigation.points
  }

  private var progress: RouteProgress?
  private var latestFix: (latitude: Double, longitude: Double, speedMps: Double?)?

  private func progressAtLatestFix() -> RouteProgress? {
    guard let fix = latestFix, let navigation = state, let points = ridePath(navigation) else { return nil }
    return RouteProgress.compute(
      points: points, riderLatitude: fix.latitude, riderLongitude: fix.longitude, speedMps: fix.speedMps,
      navigationRevision: navigation.revision,
      routeDistanceMeters: navigation.distanceMeters, routeDurationSeconds: navigation.durationSeconds
    )
  }

  var currentProgress: RouteProgress? { lock.withLock { progress } }

  var onProgressChange: ((RouteProgress?) -> Void)?

  // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationController.kt `onFix`
  private var rerouteDistanceMeters = defaultRerouteDistanceMeters
  private var automaticRequest: Int?
  private var nextAutomaticAtMs = 0.0
  private var automaticBackoffMs = automaticMinBackoffMs
  private var rerouteDistanceRead = 0

  func reloadRerouteDistance() {
    let read: Int = lock.withLock {
      rerouteDistanceRead += 1
      return rerouteDistanceRead
    }
    Task {
      let distance = await loadRerouteDistanceMeters()
      lock.withLock { if read == rerouteDistanceRead { rerouteDistanceMeters = distance } }
    }
  }

  func onFix(latitude: Double, longitude: Double, speedMps: Double?) {
    let work: (Int, Navigation, NavigationProfile)? = lock.withLock {
      latestFix = (latitude, longitude, speedMps)
      let next = progressAtLatestFix()
      if progress != next {
        progress = next
        onProgressChange?(next)
      }
      guard let next, let navigation = state, computingRequest == nil, automaticRequest == nil,
        next.deviationMeters > rerouteDistanceMeters, nowMillis() >= nextAutomaticAtMs
      else { return nil }
      let request = claimRequestLocked()
      automaticRequest = request
      beginComputingLocked(request)
      return (request, navigation, profile)
    }
    guard let (request, navigation, requested) = work else { return }
    Task {
      let replacement = await compute(navigation.targetLatitude, navigation.targetLongitude,
        latitude, longitude, requested)
      publish(request, replacement, keepUsablePath: true, automatic: true)
      lock.withLock {
        if automaticRequest == request { automaticRequest = nil }
        nextAutomaticAtMs = nowMillis() + automaticBackoffMs
        automaticBackoffMs = replacement.status == .ready
          ? Self.automaticMinBackoffMs : min(automaticBackoffMs * 2, Self.automaticMaxBackoffMs)
      }
      endComputing(request)
    }
  }

  private var generation = 0

  private func claimRequest() -> Int { lock.withLock { claimRequestLocked() } }

  private func claimRequestLocked() -> Int {
    let wasComputing = computingRequest != nil
    computingRequest = nil
    generation += 1
    if wasComputing {
      onChange?(state)
      onWatchChange?()
    }
    return generation
  }

  init(api: DirectionsRoutes, store: NavigationStore,
       loadRerouteDistanceMeters: @escaping () async -> Double = { defaultRerouteDistanceMeters },
       nowMillis: @escaping () -> Double = { ProcessInfo.processInfo.systemUptime * 1000 }) {
    self.loadRerouteDistanceMeters = loadRerouteDistanceMeters
    self.nowMillis = nowMillis
    self.api = api
    self.store = store
  }

  func restore() {
    let request = claimRequest()
    reloadRerouteDistance()
    Task {
      if let stored = await store.loadProfile() {
        lock.withLock { if !profileChosen { profile = stored } }
      }
      guard let stored = await store.load() else { return }
      let directionPoint: (latitude: Double, longitude: Double)?
      do { directionPoint = try await store.directionPoint() }
      catch {
        RecordingStorageFailure.reportRead(operation: "direction_point_read", error: error)
        return
      }
      let matchesDirectionPoint = stored.targetLatitude == directionPoint?.latitude
        && stored.targetLongitude == directionPoint?.longitude
      let usable = matchesDirectionPoint ? stored : nil
      publish(request, usable)
      if usable == nil { persist(request) }
    }
  }

  func setTarget(
    toLatitude: Double,
    toLongitude: Double,
    fromLatitude: Double?,
    fromLongitude: Double?
  ) {
    let request = claimRequest()
    publish(request, nil)

    guard let fromLatitude, let fromLongitude else {
      publish(request, failed(toLatitude, toLongitude, currentProfile, .fetchFailed))
      return
    }

    let requested = currentProfile
    beginComputing(request)
    Task {
      let navigation = await compute(
        toLatitude, toLongitude, fromLatitude, fromLongitude, requested
      )
      publish(request, navigation)
      endComputing(request)
    }
  }

  func selectProfile(_ next: NavigationProfile) {
    let changed: Bool = lock.withLock {
      guard profile != next || !profileChosen else { return false }
      profile = next
      _ = claimRequestLocked()
      profileChosen = true
      return true
    }
    guard changed else { return }
    Task {
      await writes.enqueue { [self] in await store.saveProfile(currentProfile) }
    }
  }

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

    beginComputing(request)
    Task {
      let navigation = await compute(
        toLatitude, toLongitude, fromLatitude, fromLongitude, requested
      )
      publish(request, navigation, keepUsablePath: true)
      endComputing(request)
    }
  }

  private func beginComputing(_ request: Int) { lock.withLock { beginComputingLocked(request) } }

  private func beginComputingLocked(_ request: Int) {
    guard request == generation else { return }
    computingRequest = request
    onChange?(state)
    onWatchChange?()
  }

  private func endComputing(_ request: Int) {
    lock.withLock {
      guard computingRequest == request else { return }
      computingRequest = nil
      onChange?(state)
      onWatchChange?()
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
    case let .path(points, distanceMeters, durationSeconds):
      return NavigationUsability.isUsable(
        points, targetLatitude: toLatitude, targetLongitude: toLongitude
      )
        ? Navigation(
          targetLatitude: toLatitude,
          targetLongitude: toLongitude,
          profile: profile,
          computedAtMs: Int64(Date().timeIntervalSince1970 * 1000),
          status: .ready,
          distanceMeters: distanceMeters,
          durationSeconds: durationSeconds,
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
      distanceMeters: 0,
      durationSeconds: 0,
      points: []
    )
  }

  func clear() {
    publish(claimRequest(), nil)
  }

  private func publish(_ request: Int, _ navigation: Navigation?, keepUsablePath: Bool = false, automatic: Bool = false) {
    let committed: Bool = lock.withLock {
      guard request == generation, !isSame(state, navigation) else { return false }
      if keepUsablePath, navigation?.status != .ready, state?.status == .ready { return false }
      let previousPath = ridePath(state)
      var next = navigation
      if next != nil {
        revision += 1
        next?.revision = revision
        next?.automatic = automatic
      }
      state = next
      let previousProgress = progress
      progress = progressAtLatestFix()
      onChange?(state)
      if previousProgress != progress { onProgressChange?(progress) }
      let nextPath = ridePath(state)
      if !samePath(previousPath, nextPath) { onPathChange?(nextPath) }
      onWatchChange?()
      return true
    }
    if committed { persist(request) }
  }

  private func persist(_ request: Int) {
    Task {
      await writes.enqueue { [self] in
        let navigation: Navigation?? = lock.withLock { request == generation ? .some(state) : nil }
        guard let navigation else { return }
        await store.save(navigation)
      }
    }
  }

  private func samePath(
    _ a: [(latitude: Double, longitude: Double)]?,
    _ b: [(latitude: Double, longitude: Double)]?
  ) -> Bool {
    switch (a, b) {
    case (nil, nil): return true
    case let (a?, b?):
      return a.count == b.count
        && zip(a, b).allSatisfy { $0.latitude == $1.latitude && $0.longitude == $1.longitude }
    default: return false
    }
  }

  private func isSame(_ a: Navigation?, _ b: Navigation?) -> Bool {
    switch (a, b) {
    case (nil, nil): return true
    case let (a?, b?):
      return a.computedAtMs == b.computedAtMs
        && a.targetLatitude == b.targetLatitude
        && a.targetLongitude == b.targetLongitude
        && a.status == b.status
        && a.profile == b.profile
        && a.distanceMeters == b.distanceMeters
        && a.durationSeconds == b.durationSeconds
        && a.points.count == b.points.count
        && zip(a.points, b.points).allSatisfy { $0.latitude == $1.latitude && $0.longitude == $1.longitude }
    default: return false
    }
  }
}

private actor SerialWrites {
  private var tail: Task<Void, Never>?

  func enqueue(_ work: @escaping () async -> Void) {
    let previous = tail
    tail = Task {
      await previous?.value
      await work()
    }
  }
}
