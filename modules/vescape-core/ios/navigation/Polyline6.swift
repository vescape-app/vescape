import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/Polyline6.kt
enum Polyline6 {
  private static let scale = 1_000_000.0

  static func decode(_ encoded: String) -> [(latitude: Double, longitude: Double)] {
    var cursor = Cursor(encoded)
    var points: [(latitude: Double, longitude: Double)] = []
    var latitude = 0
    var longitude = 0

    while cursor.hasMore {
      guard let latitudeDelta = cursor.nextDelta(), let longitudeDelta = cursor.nextDelta() else { break }
      latitude += latitudeDelta
      longitude += longitudeDelta
      points.append((Double(latitude) / scale, Double(longitude) / scale))
    }

    return points
  }

  static func encode(_ points: [(latitude: Double, longitude: Double)]) -> String {
    var encoded = ""
    var latitude = 0
    var longitude = 0

    for point in points {
      let nextLatitude = Int((point.latitude * scale).rounded())
      let nextLongitude = Int((point.longitude * scale).rounded())
      appendDelta(nextLatitude - latitude, to: &encoded)
      appendDelta(nextLongitude - longitude, to: &encoded)
      latitude = nextLatitude
      longitude = nextLongitude
    }

    return encoded
  }

  private static func appendDelta(_ delta: Int, to encoded: inout String) {
    var remaining = delta < 0 ? ~(delta << 1) : delta << 1
    while remaining >= 0x20 {
      encoded.append(Character(UnicodeScalar(UInt8((0x20 | (remaining & 0x1f)) + 63))))
      remaining >>= 5
    }
    encoded.append(Character(UnicodeScalar(UInt8(remaining + 63))))
  }

  private struct Cursor {
    private let units: [Int]
    private var index = 0

    init(_ encoded: String) {
      units = encoded.unicodeScalars.map { Int($0.value) - 63 }
    }

    var hasMore: Bool { index < units.count }

    mutating func nextDelta() -> Int? {
      var shift = 0
      var result = 0
      var chunk = 0

      repeat {
        guard index < units.count else { return nil }
        chunk = units[index]
        index += 1
        result |= (chunk & 0x1f) << shift
        shift += 5
      } while chunk >= 0x20

      return result & 1 != 0 ? ~(result >> 1) : result >> 1
    }
  }
}
