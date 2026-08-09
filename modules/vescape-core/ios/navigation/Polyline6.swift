import Foundation

/// Decoder for Mapbox's `polyline6` geometry encoding — the Encoded Polyline Algorithm at 1e6
/// precision. Pure and dependency-free on purpose: the algorithm is a few lines and a decoder is
/// not worth a third-party package on either platform.
///
/// The 1e6 scale is the whole trap. Classic Google polylines are 1e5, and decoding a polyline6 body
/// with a 1e5 scale yields coordinates ten times too large — which reads as a projection bug on the
/// map rather than as a decoding bug. Request `geometries=polyline6` and decode at 1e6, always.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/navigation/Polyline6.kt
enum Polyline6 {
  private static let scale = 1_000_000.0

  /// Decoded points in encoding order, each `(latitude, longitude)`. Note that this is the opposite
  /// order from the `[longitude, latitude]` pairs that cross the bridge as GeoJSON.
  ///
  /// A truncated or malformed body decodes to whatever prefix was well-formed rather than throwing:
  /// a partial path is still drawable, and Navigation has no failure UI in this slice.
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

  /// Walks the encoded string one zigzag varint at a time, so both axes share one reader.
  private struct Cursor {
    private let units: [Int]
    private var index = 0

    init(_ encoded: String) {
      units = encoded.unicodeScalars.map { Int($0.value) - 63 }
    }

    var hasMore: Bool { index < units.count }

    /// Next delta, or `nil` when the string ends part-way through one.
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

      // Low bit is the sign, so negative values arrive as the inverted shifted magnitude.
      return result & 1 != 0 ? ~(result >> 1) : result >> 1
    }
  }
}
