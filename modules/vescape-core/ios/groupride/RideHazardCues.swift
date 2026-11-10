import Foundation

/// Decides when another Rider's Ride Hazard is announced: never when it is marked, only once the
/// device's GPS fix comes within `approachRadiusM` of it while closing in, about 5 s ahead at a trail
/// pace. Each hazard (rider id + `startedAt`) cues once; a replaced hazard is a new pin. Closing in
/// means the distance shrank by at least `minClosingM` since the previous fix, so GPS jitter while
/// standing next to a hazard stays silent. Pure: the observer feeds it rosters and fixes.
///
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

  /// Other Riders' active hazards in the last roster of the joined ride.
  private var hazards: [Key: RideHazard] = [:]
  private var distances: [Key: Double] = [:]
  private var announced: Set<Key> = []

  /// Other Riders' active hazards by rider id; the rider's own never cues.
  mutating func roster(_ riderHazards: [String: RideHazard]) {
    hazards = Dictionary(uniqueKeysWithValues: riderHazards.map { (Key(riderId: $0.key, startedAt: $0.value.startedAt), $0.value) })
    distances = distances.filter { hazards[$0.key] != nil }
    announced = announced.filter { hazards[$0] != nil }
  }

  /// A new device fix: `groupRide.hazard.<kind>` of the nearest hazard just approached, else nil.
  mutating func fix(lat: Double, lng: Double) -> String? {
    var cue: (key: Key, distance: Double)?
    for (key, hazard) in hazards where !announced.contains(key) {
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
