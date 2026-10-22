import Foundation

/// A precise recent phone fix, in metres from the current Rider, independent of Navigation.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchTrail.kt
struct WatchTrailPoint: Equatable {
  let eastM: Double
  let northM: Double
}

/// Absolute display anchor for map motion, independent of the route origin and history retention.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchTrail.kt `WatchMapPosition`
struct WatchMapPosition: Equatable {
  let latitude: Double
  let longitude: Double

  func offset(from origin: WatchMapPosition) -> WatchTrailPoint {
    let longitudeDelta = (longitude - origin.longitude + 540).truncatingRemainder(dividingBy: 360) - 180
    return WatchTrailPoint(
      eastM: longitudeDelta * 111_320 * cos(origin.latitude * .pi / 180),
      northM: (latitude - origin.latitude) * 110_574
    )
  }
}

struct WatchTrailSnapshot: Equatable {
  var points: [WatchTrailPoint] = []
  var position: WatchMapPosition?
  var displayMotion: GpsDisplayMotion?
}

/// Snapshot: ASCII TR, version 2, count, Float64 rider latitude/longitude (NaN if absent), then
/// little-endian Float32 east/north pairs. Missing/unknown/malformed leaves telemetry readable.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchTrail.kt `WatchTrailCodec`
enum WatchTrailCodec {
  static let maxPoints = 120

  static func encode(_ points: [WatchTrailPoint], position: WatchMapPosition? = nil, displayMotion: GpsDisplayMotion? = nil) -> Data {
    precondition(points.count <= maxPoints)
    var data = Data([84, 82, displayMotion == nil ? 2 : 4, UInt8(points.count)])
    for value in [position?.latitude ?? .nan, position?.longitude ?? .nan] {
      withUnsafeBytes(of: value.bitPattern.littleEndian) { data.append(contentsOf: $0) }
    }
    for point in points {
      for value in [point.eastM, point.northM] {
        withUnsafeBytes(of: Float(value).bitPattern.littleEndian) { data.append(contentsOf: $0) }
      }
    }
    if let motion = displayMotion {
      for value in [motion.fromLatitude, motion.fromLongitude, motion.toLatitude, motion.toLongitude,
        Double(motion.startsAtMs), Double(motion.endsAtMs), motion.latitudePerMs, motion.longitudePerMs,
        Double(motion.velocityExpiresAtMs), motion.resetPosition ? 1.0 : 0.0] {
        withUnsafeBytes(of: value.bitPattern.littleEndian) { data.append(contentsOf: $0) }
      }
    }
    return data
  }

  static func decode(_ data: Data, offset: Int) -> WatchTrailSnapshot {
    let bytes = [UInt8](data)
    let empty = WatchTrailSnapshot()
    guard offset >= 0, bytes.count - offset >= 20,
      bytes[offset] == 84, bytes[offset + 1] == 82, (2...4).contains(bytes[offset + 2])
    else { return empty }
    let count = Int(bytes[offset + 3])
    let motionBytes = bytes[offset + 2] == 4 ? 80 : (bytes[offset + 2] == 3 ? 48 : 0)
    guard count <= maxPoints, bytes.count - offset - 20 == count * 8 + motionBytes else { return empty }
    func raw(_ at: Int, _ count: Int) -> UInt64 {
      (0..<count).reduce(0) { $0 | UInt64(bytes[at + $1]) << ($1 * 8) }
    }
    let latitude = Double(bitPattern: raw(offset + 4, 8))
    let longitude = Double(bitPattern: raw(offset + 12, 8))
    var position: WatchMapPosition?
    if !(latitude.isNaN && longitude.isNaN) {
      guard (-90...90).contains(latitude), (-180...180).contains(longitude) else { return empty }
      position = WatchMapPosition(latitude: latitude, longitude: longitude)
    }
    let points = (0..<count).map { i in
      WatchTrailPoint(
        eastM: Double(Float(bitPattern: UInt32(raw(offset + 20 + i * 8, 4)))),
        northM: Double(Float(bitPattern: UInt32(raw(offset + 24 + i * 8, 4))))
      )
    }
    guard points.allSatisfy({ $0.eastM.isFinite && $0.northM.isFinite }) else { return empty }
    var motion: GpsDisplayMotion?
    if motionBytes > 0 {
      let at = offset + 20 + count * 8
      let values = (0..<(motionBytes / 8)).map { Double(bitPattern: raw(at + $0 * 8, 8)) }
      if values.allSatisfy({ $0.isFinite }), abs(values[0]) <= 90, abs(values[1]) <= 180,
        abs(values[2]) <= 90, abs(values[3]) <= 180, values[4] >= 0,
        values[5] >= values[4], values[5] - values[4] <= 10_000, values[5] < Double(Int64.max),
        values.count == 6 || (values[8] >= 0 && values[8] < Double(Int64.max) && values[8] <= values[4] + 5_000 && (values[9] == 0 || values[9] == 1)) {
        motion = GpsDisplayMotion(fromLatitude: values[0], fromLongitude: values[1],
          toLatitude: values[2], toLongitude: values[3], startsAtMs: Int64(values[4]), endsAtMs: Int64(values[5]),
          resetPosition: values.count > 6 ? values[9] == 1 : false,
          latitudePerMs: values.count > 6 ? values[6] : 0, longitudePerMs: values.count > 6 ? values[7] : 0,
          velocityExpiresAtMs: values.count > 6 ? Int64(values[8]) : 0)
      }
    }
    return WatchTrailSnapshot(points: points, position: position, displayMotion: motion)
  }
}

/// Main map's native recent precise fixes, sampled to a bounded wrist snapshot. No watch history.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchTrailBuilder.kt `watchTrail`
func watchTrail(rider: WatchGeoPoint?, history: [[String: Any?]]) -> [WatchTrailPoint] {
  guard let rider else { return [] }
  let fixes: [WatchGeoPoint] = history.compactMap { row in
    guard let lat = (row["latitude"] ?? nil) as? Double,
      let lon = (row["longitude"] ?? nil) as? Double, lat.isFinite, lon.isFinite
    else { return nil }
    return WatchGeoPoint(latitude: lat, longitude: lon)
  }
  guard !fixes.isEmpty else { return [] }
  let count = min(fixes.count, WatchTrailCodec.maxPoints)
  return (0..<count).map { i in
    let index = count == 1 ? 0 : i * (fixes.count - 1) / (count - 1)
    let offset = watchOffsetMeters(origin: rider, point: fixes[index])
    return WatchTrailPoint(eastM: offset.east, northM: offset.north)
  }
}
