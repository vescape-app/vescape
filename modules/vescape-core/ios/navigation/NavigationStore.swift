import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationStore.kt `NavigationStore`
protocol NavigationStore {
  func load() async -> Navigation?

  func save(_ navigation: Navigation?) async

  func directionPoint() async throws -> (latitude: Double, longitude: Double)?

  func loadProfile() async -> NavigationProfile?

  func saveProfile(_ profile: NavigationProfile) async
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationStore.kt `NavigationJson`
enum NavigationJson {
  enum DecodeError: Error { case malformed }
  private static let targetLatitudeKey = "targetLatitude"
  private static let targetLongitudeKey = "targetLongitude"
  private static let profileKey = "profile"
  private static let computedAtMsKey = "computedAtMs"
  private static let statusKey = "status"
  private static let geometryKey = "geometry"
  private static let distanceMetersKey = "distanceMeters"
  private static let durationSecondsKey = "durationSeconds"

  static func encode(_ navigation: Navigation) throws -> String {
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
    guard JSONSerialization.isValidJSONObject(stored) else {
      throw CocoaError(.propertyListWriteInvalid)
    }
    let data = try JSONSerialization.data(withJSONObject: stored)
    guard let json = String(data: data, encoding: .utf8) else {
      throw CocoaError(.fileWriteInapplicableStringEncoding)
    }
    return json
  }

  static func decode(_ json: String) throws -> Navigation? {
    guard
      let data = json.data(using: .utf8),
      let stored = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      let targetLatitude = stored[targetLatitudeKey] as? Double,
      let targetLongitude = stored[targetLongitudeKey] as? Double,
      let computedAtMs = (stored[computedAtMsKey] as? NSNumber)?.int64Value,
      let geometry = stored[geometryKey] as? String
    else { throw DecodeError.malformed }
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
      distanceMeters: (stored[distanceMetersKey] as? NSNumber)?.doubleValue ?? 0,
      durationSeconds: (stored[durationSecondsKey] as? NSNumber)?.doubleValue ?? 0,
      points: points
    )
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/NavigationStore.kt `AppDataNavigationStore`
struct AppDataNavigationStore: NavigationStore {
  private let repository = AppDataRepository.shared

  func load() async -> Navigation? {
    let stored: String?
    do { stored = try repository.getNavigationPath() }
    catch { RecordingStorageFailure.reportRead(operation: "navigation_path_read", error: error); return nil }
    guard let stored else { return nil }
    do { return try NavigationJson.decode(stored) }
    catch {
      UnexpectedNativeError.report(operation: "navigation_path_decode", category: "serialization", error: error)
      return nil
    }
  }

  func save(_ navigation: Navigation?) async {
    let encoded: String?
    do { encoded = try navigation.map(NavigationJson.encode) }
    catch {
      UnexpectedNativeError.report(operation: "navigation_path_encode", category: "serialization", error: error)
      return
    }
    do { try repository.setNavigationPath(encoded) }
    catch { RecordingStorageFailure.report(operation: "navigation_path_save", category: "write_failed", error: error) }
  }

  func directionPoint() async throws -> (latitude: Double, longitude: Double)? {
    try repository.getDirectionPoint()
  }

  func loadProfile() async -> NavigationProfile? {
    do { return try repository.getNavigationProfile().map(NavigationProfile.fromWire) }
    catch { RecordingStorageFailure.reportRead(operation: "navigation_profile_read", error: error); return nil }
  }

  func saveProfile(_ profile: NavigationProfile) async {
    do { try repository.setNavigationProfile(profile.rawValue) }
    catch { RecordingStorageFailure.report(operation: "navigation_profile_save", category: "write_failed", error: error) }
  }
}
