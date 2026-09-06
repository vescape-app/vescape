import Foundation

/// Durable home for the one Navigation, and for the Direction Point it must still agree with.
///
/// A seam rather than a direct repository call, so `NavigationController`'s restore and staleness
/// rules are testable without a database.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationStore.kt `NavigationStore`
protocol NavigationStore {
  /// The stored Navigation, or `nil` when none was ever written or the row is unreadable.
  func load() async -> Navigation?

  /// Replaces the stored Navigation. `nil` erases it.
  func save(_ navigation: Navigation?) async

  /// The current Direction Point as `(latitude, longitude)`. A restored path is only usable while it
  /// still leads here.
  func directionPoint() async -> (latitude: Double, longitude: Double)?

  /// The rider's last chosen Navigation Profile, or `nil` when they have never chosen one. Stored
  /// apart from the path because it outlives it: it is what the *next* Navigation is computed under.
  func loadProfile() async -> NavigationProfile?

  func saveProfile(_ profile: NavigationProfile) async
}

/// Wire form of a stored Navigation. The path rides as its `polyline6` body rather than as a
/// coordinate array: for an 83 km walking route (3802 points) that is 14.5 KB against 81 KB of
/// `[longitude, latitude]` JSON, a 5.6x saving on the largest value the app stores.
///
/// Kept a plain string-in, string-out codec so it is testable without a database, and so the stored
/// form stays a value a later slice can ship over the Group Ride relay unchanged.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationStore.kt `NavigationJson`
enum NavigationJson {
  private static let targetLatitudeKey = "targetLatitude"
  private static let targetLongitudeKey = "targetLongitude"
  private static let profileKey = "profile"
  private static let computedAtMsKey = "computedAtMs"
  private static let statusKey = "status"
  private static let geometryKey = "geometry"
  private static let distanceMetersKey = "distanceMeters"
  private static let durationSecondsKey = "durationSeconds"

  static func encode(_ navigation: Navigation) -> String? {
    let stored: [String: Any] = [
      targetLatitudeKey: navigation.targetLatitude,
      targetLongitudeKey: navigation.targetLongitude,
      profileKey: navigation.profile.rawValue,
      computedAtMsKey: navigation.computedAtMs,
      statusKey: navigation.status.rawValue,
      distanceMetersKey: navigation.distanceMeters,
      durationSecondsKey: navigation.durationSeconds,
      geometryKey: Polyline6.encode(navigation.points),
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: stored) else { return nil }
    return String(data: data, encoding: .utf8)
  }

  /// Parses `json`, or returns `nil` when it is malformed. A failed Navigation is stored and
  /// restored like any other: the rider comes back to the same "no path here, retry?" they left,
  /// never to a spinner and never to a line that was never computed.
  ///
  /// A `ready` row with no points is a contradiction and is dropped — the rider can set the pin
  /// again. Rows written before the status existed always carried points, so their missing key
  /// defaults to `ready`.
  static func decode(_ json: String) -> Navigation? {
    guard
      let data = json.data(using: .utf8),
      let stored = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let targetLatitude = stored[targetLatitudeKey] as? Double,
      let targetLongitude = stored[targetLongitudeKey] as? Double,
      let computedAtMs = (stored[computedAtMsKey] as? NSNumber)?.int64Value,
      let geometry = stored[geometryKey] as? String
    else { return nil }
    let profile = NavigationProfile.fromWire(stored[profileKey] as? String)
    let status = (stored[statusKey] as? String).flatMap(NavigationStatus.init(rawValue:)) ?? .ready
    let points = Polyline6.decode(geometry)
    guard status != .ready || !points.isEmpty else { return nil }
    return Navigation(
      targetLatitude: targetLatitude,
      targetLongitude: targetLongitude,
      profile: profile,
      computedAtMs: computedAtMs,
      status: status,
      // Rows written before the path carried its length restore without one; the sheet then shows
      // the path with no numbers rather than refusing a perfectly rideable stored line.
      distanceMeters: (stored[distanceMetersKey] as? NSNumber)?.doubleValue ?? 0,
      durationSeconds: (stored[durationSecondsKey] as? NSNumber)?.doubleValue ?? 0,
      points: points
    )
  }
}

/// The real store: one App Settings row next to the Direction Point's own two. No schema migration —
/// App Settings are key/value rows, not columns — and the row is deliberately outside the settings
/// projection JS mirrors, so a 14 KB path never rides along on an unrelated settings read.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationStore.kt `AppDataNavigationStore`
struct AppDataNavigationStore: NavigationStore {
  private let repository = AppDataRepository.shared

  func load() async -> Navigation? {
    repository.getNavigationPath().flatMap(NavigationJson.decode)
  }

  func save(_ navigation: Navigation?) async {
    repository.setNavigationPath(navigation.flatMap(NavigationJson.encode))
  }

  func directionPoint() async -> (latitude: Double, longitude: Double)? {
    repository.getDirectionPoint()
  }

  func loadProfile() async -> NavigationProfile? {
    repository.getNavigationProfile().map(NavigationProfile.fromWire)
  }

  func saveProfile(_ profile: NavigationProfile) async {
    repository.setNavigationProfile(profile.rawValue)
  }
}
