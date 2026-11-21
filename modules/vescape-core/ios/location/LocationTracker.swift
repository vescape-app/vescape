import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/LocationTracker.kt
internal final class LocationTracker {
  private(set) var latestLocation: TelemetryLocationCapture?
  private(set) var latestPreciseLocation: TelemetryLocationCapture?
  private(set) var recentLocations: [[String: Any?]] = []
  private let courseDeriver = GpsCourseDeriver()
  private let recentWindowMs: () -> Int64
  private let recordLocation: (TelemetryLocationCapture) -> Void
  private let navigationFix: (TelemetryLocationCapture) -> Void
  private let persistLocation: (TelemetryLocationCapture) -> Void

  init(
    recentWindowMs: @escaping () -> Int64,
    recordLocation: @escaping (TelemetryLocationCapture) -> Void,
    navigationFix: @escaping (TelemetryLocationCapture) -> Void,
    persistLocation: @escaping (TelemetryLocationCapture) -> Void
  ) {
    self.recentWindowMs = recentWindowMs
    self.recordLocation = recordLocation
    self.navigationFix = navigationFix
    self.persistLocation = persistLocation
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/LocationTracker.kt `riderPosition`
  var riderPosition: TelemetryLocationCapture? { latestLocation ?? latestPreciseLocation }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/LocationTracker.kt `onLocationUpdated`
  func onLocationUpdated(_ incoming: TelemetryLocationCapture) -> TelemetryLocationCapture {
    let location = withCourse(incoming)
    recordLocation(location)
    latestLocation = location
    navigationFix(location)
    if location.precise {
      latestPreciseLocation = location
      persistLocation(location)
      appendRecent(location)
    }
    return location
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/LocationTracker.kt `prefill`
  func prefill(_ incoming: TelemetryLocationCapture) {
    let location = withCourse(incoming)
    latestLocation = location
    if location.precise {
      latestPreciseLocation = location
      appendRecent(location)
    }
  }

  private func withCourse(_ incoming: TelemetryLocationCapture) -> TelemetryLocationCapture {
    guard incoming.precise else { return incoming }
    var location = incoming
    let course = courseDeriver.derive(
      latitude: location.latitude,
      longitude: location.longitude,
      speedMps: location.speedMps,
      bearingDeg: location.bearingDeg,
      timestamp: location.timestamp
    )
    location.courseDeg = course?.bearingDeg
    location.courseSourceTimestamp = course?.sourceTimestamp
    return location
  }

  private func appendRecent(_ location: TelemetryLocationCapture) {
    recentLocations.append(location.map)
    pruneRecentLocations(now: location.timestamp)
  }

  func pruneRecentLocations(now: Int64) {
    let oldest = now - recentWindowMs()
    recentLocations.removeAll { row in
      guard let timestamp = (row["timestamp"] ?? nil) as? NSNumber else { return false }
      return timestamp.int64Value < oldest
    }
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/LocationTracker.kt `resetTrail`
  func resetTrail() {
    latestLocation = nil
    latestPreciseLocation = nil
    courseDeriver.reset()
    recentLocations.removeAll(keepingCapacity: true)
  }
}
