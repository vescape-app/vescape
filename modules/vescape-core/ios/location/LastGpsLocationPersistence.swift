import Foundation

/// App-lifetime last position, independent of Ride Recording and Board Session teardown.
/// Calls arrive serially from the GPS callback; database writes run on a serial utility queue.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/location/LocationTracker.kt `persistLastGpsLocation`
final class LastGpsLocationPersistence {
  private let appData: AppDataRepository
  private let queue: DispatchQueue
  private let nowMs: () -> Int64
  private var lastGpsPersistedAt: Int64 = 0

  init(
    appData: AppDataRepository,
    queue: DispatchQueue = DispatchQueue(label: "vescape.last-gps-persistence", qos: .utility),
    nowMs: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }
  ) {
    self.appData = appData
    self.queue = queue
    self.nowMs = nowMs
  }

  func onLocationUpdated(_ location: TelemetryLocationCapture) {
    guard location.precise else { return }
    let now = nowMs()
    guard now - lastGpsPersistedAt >= LAST_GPS_PERSIST_INTERVAL_MS else { return }
    lastGpsPersistedAt = now
    queue.async { [appData] in
      appData.updateLastGpsLocation(latitude: location.latitude, longitude: location.longitude)
    }
  }
}
