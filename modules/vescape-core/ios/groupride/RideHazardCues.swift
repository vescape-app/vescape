import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RideHazardCues.kt `RideHazardCues`
struct RideHazardCues {
  static let cuePrefix = "groupRide.hazard."
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RideHazardCues.kt `APPROACH_RADIUS_M`
  static let approachRadiusM = 30.0
  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/RideHazardCues.kt `MIN_CLOSING_M`
  static let minClosingM = 2.0

  private struct Key: Hashable {
    let riderId: String
    let startedAt: Int64
  }

  private var hazards: [Key: RideHazard] = [:]
  private var distances: [Key: Double] = [:]
  private var announced: Set<Key> = []

  mutating func roster(_ riderHazards: [String: RideHazard]) {
    hazards = Dictionary(uniqueKeysWithValues: riderHazards.map { (Key(riderId: $0.key, startedAt: $0.value.startedAt), $0.value) })
    distances = distances.filter { hazards[$0.key] != nil }
    announced = announced.filter { hazards[$0] != nil }
  }

  mutating func fix(lat: Double, lng: Double, relayNow: Int64) -> String? {
    var cue: (key: Key, distance: Double)?
    for (key, hazard) in hazards where hazard.expiresAt > relayNow && !announced.contains(key) {
      let distance = GeoMath.distanceMeters(lat, lng, hazard.lat, hazard.lng)
      let previous = distances.updateValue(distance, forKey: key)
      let closing = previous.map { $0 - distance >= Self.minClosingM } ?? false
      if distance <= Self.approachRadiusM, closing, distance < (cue?.distance ?? .greatestFiniteMagnitude) {
        cue = (key, distance)
      }
    }
    guard let key = cue?.key, let hazard = hazards[key] else { return nil }
    announced.insert(key)
    return Self.cuePrefix + hazard.kind.rawValue
  }

  mutating func reset() {
    hazards = [:]
    distances = [:]
    announced = []
  }
}
