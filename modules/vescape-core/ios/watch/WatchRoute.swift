import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchRoute.kt `WATCH_ROUTE_PATH`
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRoute.kt `ROUTE_PATH`
/// @platform-diff Android gets one Data Layer path per channel and clears the route by *deleting*
let watchRouteChannel = "route"

enum WatchRouteKey {
  static let version = "version"
  /// The packed polyline. **Absent means cleared** — see the channel's `@platform-diff`.
  static let points = "points"
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchRoute.kt `WATCH_ROUTE_VERSION`
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRoute.kt `WATCH_ROUTE_VERSION`
let WATCH_ROUTE_VERSION = 1

private let MICRO_DEGREES = 1_000_000.0

let WATCH_ROUTE_HEADER_BYTES = 1 + 2 + 8 + 8

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchRoute.kt `WATCH_ROUTE_MAX_POINTS`
/// @platform-diff Android allows 8 000 points because a Data Layer item is its own asset and the
let WATCH_ROUTE_MAX_POINTS = 2_000

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchRoute.kt `GeoPoint`
struct WatchGeoPoint: Equatable {
  var latitude: Double
  var longitude: Double
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRoute.kt `RoutePoint`
struct WatchRoutePoint: Equatable {
  var eastM: Double
  var northM: Double
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRoute.kt `WatchRoute`
struct WatchRoute: Equatable {
  var points: [WatchRoutePoint]
  var routeId: UInt32? = nil

  static func decode(context: [String: Any]) -> WatchRoute? {
    guard let payload = context[watchRouteChannel] as? [String: Any] else { return nil }
    guard (payload[WatchRouteKey.version] as? NSNumber)?.intValue == WATCH_ROUTE_VERSION else { return nil }
    guard let packed = payload[WatchRouteKey.points] as? Data else { return nil }
    return WatchRouteCodec.decode(packed)
  }
}

private let METERS_PER_DEGREE_LAT = 110_574.0
private let METERS_PER_DEGREE_LON_EQUATOR = 111_320.0

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchRoute.kt `offsetMeters`
func watchOffsetMeters(origin: WatchGeoPoint, point: WatchGeoPoint) -> (east: Double, north: Double) {
  let east = (point.longitude - origin.longitude) * METERS_PER_DEGREE_LON_EQUATOR
    * cos(origin.latitude * .pi / 180)
  let north = (point.latitude - origin.latitude) * METERS_PER_DEGREE_LAT
  return (east, north)
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchRoute.kt `WatchRouteEncoder`
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRoute.kt `WatchRouteDecoder`
enum WatchRouteCodec {
  static func payload(points: [WatchGeoPoint]) -> [String: Any] {
    var payload: [String: Any] = [WatchRouteKey.version: WATCH_ROUTE_VERSION]
    if let packed = encode(points) { payload[WatchRouteKey.points] = packed }
    return payload
  }

  static func origin(points: [WatchGeoPoint]) -> WatchGeoPoint? { kept(points).first }

  static func encode(_ points: [WatchGeoPoint]) -> Data? {
    let kept = kept(points)
    guard let origin = kept.first else { return nil }
    var data = Data(capacity: WATCH_ROUTE_HEADER_BYTES + (kept.count - 1) * 8)
    data.append(UInt8(WATCH_ROUTE_VERSION))
    appendLittleEndian(&data, UInt16(kept.count))
    appendLittleEndian(&data, origin.latitude.bitPattern)
    appendLittleEndian(&data, origin.longitude.bitPattern)
    var latitude: Int64 = 0
    var longitude: Int64 = 0
    for point in kept.dropFirst() {
      let targetLat = Int64(((point.latitude - origin.latitude) * MICRO_DEGREES).rounded())
      let targetLon = Int64(((point.longitude - origin.longitude) * MICRO_DEGREES).rounded())
      appendLittleEndian(&data, UInt32(bitPattern: Int32(truncatingIfNeeded: targetLat - latitude)))
      appendLittleEndian(&data, UInt32(bitPattern: Int32(truncatingIfNeeded: targetLon - longitude)))
      latitude = targetLat
      longitude = targetLon
    }
    return data
  }

  static func decode(_ data: Data) -> WatchRoute? {
    guard data.count >= WATCH_ROUTE_HEADER_BYTES else { return nil }
    let bytes = [UInt8](data)
    guard Int(bytes[0]) == WATCH_ROUTE_VERSION else { return nil }
    let count = Int(bytes[1]) | Int(bytes[2]) << 8
    guard count > 0, bytes.count >= WATCH_ROUTE_HEADER_BYTES + (count - 1) * 8 else { return nil }
    let originLatitude = Double(bitPattern: uint64(bytes, at: 3))
    let lonScale = METERS_PER_DEGREE_LON_EQUATOR * cos(originLatitude * .pi / 180)

    var points: [WatchRoutePoint] = [WatchRoutePoint(eastM: 0, northM: 0)]
    points.reserveCapacity(count)
    var latitude: Int64 = 0
    var longitude: Int64 = 0
    for index in 1..<count {
      let offset = WATCH_ROUTE_HEADER_BYTES + (index - 1) * 8
      latitude += Int64(Int32(bitPattern: uint32(bytes, at: offset)))
      longitude += Int64(Int32(bitPattern: uint32(bytes, at: offset + 4)))
      points.append(
        WatchRoutePoint(
          eastM: Double(longitude) / MICRO_DEGREES * lonScale,
          northM: Double(latitude) / MICRO_DEGREES * METERS_PER_DEGREE_LAT
        )
      )
    }
    return WatchRoute(points: points, routeId: WatchRouteStatusCodec.routeId(data))
  }

  /// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchRoute.kt `simplify`
  private static func kept(_ points: [WatchGeoPoint]) -> [WatchGeoPoint] {
    guard points.count > WATCH_ROUTE_MAX_POINTS else { return points }
    let stride = Double(points.count - 1) / Double(WATCH_ROUTE_MAX_POINTS - 1)
    return (0..<WATCH_ROUTE_MAX_POINTS).map {
      points[min(Int((Double($0) * stride).rounded()), points.count - 1)]
    }
  }

  private static func appendLittleEndian<T: FixedWidthInteger>(_ data: inout Data, _ value: T) {
    withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) }
  }

  private static func uint32(_ bytes: [UInt8], at offset: Int) -> UInt32 {
    UInt32(bytes[offset])
      | UInt32(bytes[offset + 1]) << 8
      | UInt32(bytes[offset + 2]) << 16
      | UInt32(bytes[offset + 3]) << 24
  }

  private static func uint64(_ bytes: [UInt8], at offset: Int) -> UInt64 {
    UInt64(uint32(bytes, at: offset)) | UInt64(uint32(bytes, at: offset + 4)) << 32
  }
}
