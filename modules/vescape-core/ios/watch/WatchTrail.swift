import Foundation

/// A precise recent phone fix, in metres from the current Rider, independent of Navigation.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchTrail.kt
struct WatchTrailPoint: Equatable {
  let eastM: Double
  let northM: Double
}

/// Snapshot after the fixed Watch Frame lanes: ASCII TR, version 1, count, Float32 east/north pairs.
/// Older wrists ignore it. Missing, unknown or malformed snapshots leave telemetry readable.
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchTrail.kt `WatchTrailCodec`
enum WatchTrailCodec {
  static let maxPoints = 120

  static func encode(_ points: [WatchTrailPoint]) -> Data {
    precondition(points.count <= maxPoints)
    var data = Data([84, 82, 1, UInt8(points.count)])
    for point in points {
      for value in [point.eastM, point.northM] {
        withUnsafeBytes(of: Float(value).bitPattern.littleEndian) { data.append(contentsOf: $0) }
      }
    }
    return data
  }

  static func decode(_ data: Data, offset: Int) -> [WatchTrailPoint] {
    let bytes = [UInt8](data)
    guard offset >= 0, bytes.count - offset >= 4,
      bytes[offset] == 84, bytes[offset + 1] == 82, bytes[offset + 2] == 1
    else { return [] }
    let count = Int(bytes[offset + 3])
    guard count <= maxPoints, bytes.count - offset - 4 == count * 8 else { return [] }
    func lane(_ at: Int) -> Double {
      let raw = UInt32(bytes[at]) | UInt32(bytes[at + 1]) << 8
        | UInt32(bytes[at + 2]) << 16 | UInt32(bytes[at + 3]) << 24
      return Double(Float(bitPattern: raw))
    }
    let points = (0..<count).map { i in
      WatchTrailPoint(eastM: lane(offset + 4 + i * 8), northM: lane(offset + 8 + i * 8))
    }
    return points.allSatisfy { $0.eastM.isFinite && $0.northM.isFinite } ? points : []
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
