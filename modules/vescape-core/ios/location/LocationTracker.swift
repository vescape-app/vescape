import Foundation

/// App-level fix state. Session teardown leaves it intact; only replay teardown clears it.
/// All calls use the GPS callback's serial execution context.
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

  /// Freshness beats precision for Navigation; a precise fix only fills an absent latest fix.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/LocationTracker.kt `riderPosition`
  var riderPosition: TelemetryLocationCapture? { latestLocation ?? latestPreciseLocation }

  /// Returns the enriched fix for the remaining consumers and the unchanged onLocation payload.
  /// iOS preserves its existing order: recording, latest fix, Navigation, precise state/persistence.
  /// Android currently records after emitting, and offers only precise fixes to recording.
  /// TODO(android parity): align recording consumer ordering in the Ride Track slice #448.
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/LocationTracker.kt `onLocationUpdated`
  func onLocationUpdated(_ incoming: TelemetryLocationCapture) -> TelemetryLocationCapture {
    var location = incoming
    // Approximate fixes must not feed the course deriver.
    if location.precise {
      let course = courseDeriver.derive(
        latitude: location.latitude,
        longitude: location.longitude,
        speedMps: location.speedMps,
        bearingDeg: location.bearingDeg,
        timestamp: location.timestamp
      )
      location.courseDeg = course?.bearingDeg
      location.courseSourceTimestamp = course?.sourceTimestamp
    }
    recordLocation(location)
    latestLocation = location
    navigationFix(location)
    if location.precise {
      latestPreciseLocation = location
      persistLocation(location)
      recentLocations.append(location.map)
      pruneRecentLocations(now: location.timestamp)
    }
    return location
  }

  func pruneRecentLocations(now: Int64) {
    let oldest = now - recentWindowMs()
    recentLocations.removeAll { row in
      guard let timestamp = (row["timestamp"] ?? nil) as? NSNumber else { return false }
      return timestamp.int64Value < oldest
    }
  }

  /// Clear replay-derived fixes and course without resetting the app-lifetime persistence throttle.
  /// Android currently retains replay fixes; its session teardown tracks that difference.
  func clearReplayLocations() {
    latestLocation = nil
    latestPreciseLocation = nil
    courseDeriver.reset()
    recentLocations.removeAll(keepingCapacity: true)
  }
}
