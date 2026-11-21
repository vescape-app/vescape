/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/connection/PrivacyZoneReadState.kt
internal struct PrivacyZoneReadState {
  private(set) var zones: [PrivacyZoneEntity] = []
  private(set) var ready = false
  var allowsLocationEgress: Bool { ready }

  mutating func reload(_ read: () throws -> [PrivacyZoneEntity]) throws {
    do {
      zones = try read()
      ready = true
    } catch {
      ready = false
      throw error
    }
  }

  func presenceFix(_ location: TelemetryLocationCapture?) -> TelemetryLocationCapture? {
    guard allowsLocationEgress, let location, !contains(location) else { return nil }
    return location
  }

  func signalContext(_ location: TelemetryLocationCapture?, nowMs: Int64) -> RiderSignalContext {
    let recent = location.flatMap { nowMs - $0.timestamp <= RiderSignals.fixMaxAgeMs ? $0 : nil }
    return RiderSignalContext(
      fix: recent.map { (lat: $0.latitude, lng: $0.longitude) },
      insidePrivacyZone: !allowsLocationEgress || recent.map(contains) == true
    )
  }

  private func contains(_ location: TelemetryLocationCapture) -> Bool {
    guard !zones.isEmpty else { return false }
    return isInsideAnyPrivacyZone(
      latitudeE7: Int((location.latitude * 10_000_000.0).rounded()),
      longitudeE7: Int((location.longitude * 10_000_000.0).rounded()),
      zones: zones
    )
  }
}
