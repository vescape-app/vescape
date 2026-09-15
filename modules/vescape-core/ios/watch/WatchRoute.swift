import Foundation

/// Channel the route polyline occupies inside the shared Application Context (see `WatchColdState`).
///
/// Cold state like the settings and the forecast: a route changes when the rider picks a
/// destination, never per tick, so it rides the Application Context and survives a restart or a
/// reconnect instead of being dropped like an undelivered message. Android publishes the same bytes
/// on its own `/route` Data Layer path.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchRoute.kt `WATCH_ROUTE_PATH`
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRoute.kt `ROUTE_PATH`
/// @platform-diff Android gets one Data Layer path per channel and clears the route by *deleting*
///   the data item. watchOS has a single Application Context whose channels are merged, and the
///   delivery is latest-value-wins with no delete: an absent key is indistinguishable from a key a
///   push never reached. So a cleared route is an explicit payload — the version with no points —
///   and never a removed channel, or a reconnecting wrist would restore the route the rider cleared.
let watchRouteChannel = "route"

/// Wire keys. Only two, because the polyline itself is the Android byte layout verbatim.
enum WatchRouteKey {
  /// Wire version of the packed polyline. Present on every push, cleared or not.
  static let version = "version"
  /// The packed polyline. **Absent means cleared** — see the channel's `@platform-diff`.
  static let points = "points"
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchRoute.kt `WATCH_ROUTE_VERSION`
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRoute.kt `WATCH_ROUTE_VERSION`
let WATCH_ROUTE_VERSION = 1

/// Micro-degrees per encoded unit. Points ride as int32 deltas from the previous point, which keeps
/// a long route small (8 bytes per point) while staying exact to ~0.1 m.
private let MICRO_DEGREES = 1_000_000.0

/// Header: version byte + uint16 point count + two float64 origin coordinates.
let WATCH_ROUTE_HEADER_BYTES = 1 + 2 + 8 + 8

/// Point ceiling. Anything denser is strided down before it is packed.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchRoute.kt `WATCH_ROUTE_MAX_POINTS`
/// @platform-diff Android allows 8 000 points because a Data Layer item is its own asset and the
///   route has a path to itself. Here the route shares one Application Context with the settings
///   and the forecast, and the whole dictionary is replaced as a unit, so the ceiling is lower:
///   2 000 points is ~16 KB packed, which leaves the context comfortably clear of the size limit
///   `updateApplicationContext` rejects with `WCErrorCodePayloadTooLarge`. The exact limit is not
///   published and has not been measured on hardware, which is the reason for the margin rather
///   than for a number tuned against it. The decoder is version-compatible with Android either way:
///   the cap is a pusher-side decision, not part of the wire format.
let WATCH_ROUTE_MAX_POINTS = 2_000

/// A geographic point on the phone side of the wire.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchRoute.kt `GeoPoint`
struct WatchGeoPoint: Equatable {
  var latitude: Double
  var longitude: Double
}

/// One route vertex in the wrist's drawing frame: metres east/north of the route origin, which is
/// the same frame the Watch Frame's rider lanes use, so placing the rider is a straight subtraction.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRoute.kt `RoutePoint`
struct WatchRoutePoint: Equatable {
  var eastM: Double
  var northM: Double
}

/// The route on the wrist. Nil everywhere downstream means the phone has no active route — either
/// it never sent one, or it sent the explicit clear.
///
/// One file compiled into both the phone target and the watch target, so the encoder and the
/// decoder cannot drift; Android has to carry the same layout twice, by convention, across two
/// Gradle modules (ADR-0018).
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRoute.kt `WatchRoute`
struct WatchRoute: Equatable {
  var points: [WatchRoutePoint]

  /// The route channel of a whole Application Context. Nil for an absent channel, for the explicit
  /// clear, for a version this build does not understand, and for a short or truncated buffer — a
  /// newer phone format degrades to "no route" rather than to a garbled line.
  static func decode(context: [String: Any]) -> WatchRoute? {
    guard let payload = context[watchRouteChannel] as? [String: Any] else { return nil }
    guard (payload[WatchRouteKey.version] as? NSNumber)?.intValue == WATCH_ROUTE_VERSION else { return nil }
    guard let packed = payload[WatchRouteKey.points] as? Data else { return nil }
    return WatchRouteCodec.decode(packed)
  }
}

private let METERS_PER_DEGREE_LAT = 110_574.0
private let METERS_PER_DEGREE_LON_EQUATOR = 111_320.0

/// Local flat-earth offset of `point` from `origin`, metres east and north. Good to well under a
/// metre over the tens of kilometres a route spans, which is all the wrist drawing needs — and it
/// keeps the rider's position inside Float32 telemetry lanes without losing the precision raw
/// latitude/longitude would.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchRoute.kt `offsetMeters`
func watchOffsetMeters(origin: WatchGeoPoint, point: WatchGeoPoint) -> (east: Double, north: Double) {
  let east = (point.longitude - origin.longitude) * METERS_PER_DEGREE_LON_EQUATOR
    * cos(origin.latitude * .pi / 180)
  let north = (point.latitude - origin.latitude) * METERS_PER_DEGREE_LAT
  return (east, north)
}

/// Pure polyline <-> bytes codec. The first point becomes the origin (absolute, full float64
/// precision); every later point is a micro-degree delta from the one before it.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/watch/WatchRoute.kt `WatchRouteEncoder`
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRoute.kt `WatchRouteDecoder`
enum WatchRouteCodec {
  /// The wire bag for `points`, or the explicit clear when there is nothing to draw.
  ///
  /// Empty is a clear and not an empty item: the wrist never has to tell a zero-length polyline
  /// from a missing one, which is the same rule Android's `encode` returning nil encodes.
  static func payload(points: [WatchGeoPoint]) -> [String: Any] {
    var payload: [String: Any] = [WatchRouteKey.version: WATCH_ROUTE_VERSION]
    if let packed = encode(points) { payload[WatchRouteKey.points] = packed }
    return payload
  }

  /// The origin the wrist will measure the rider against for `points` — its first point, after the
  /// same thinning `encode` applies, so the two can never disagree about which point that is.
  static func origin(points: [WatchGeoPoint]) -> WatchGeoPoint? { kept(points).first }

  static func encode(_ points: [WatchGeoPoint]) -> Data? {
    let kept = kept(points)
    guard let origin = kept.first else { return nil }
    var data = Data(capacity: WATCH_ROUTE_HEADER_BYTES + (kept.count - 1) * 8)
    data.append(UInt8(WATCH_ROUTE_VERSION))
    appendLittleEndian(&data, UInt16(kept.count))
    appendLittleEndian(&data, origin.latitude.bitPattern)
    appendLittleEndian(&data, origin.longitude.bitPattern)
    // Deltas are measured against what the decoder will have reconstructed, not against the source
    // point, so per-hop rounding cannot accumulate along a long route.
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
    // Origin longitude is read past rather than used: points are relative, and only the origin's
    // latitude scales them.
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
    return WatchRoute(points: points)
  }

  /// Even stride down to `WATCH_ROUTE_MAX_POINTS`, endpoints kept. Cheap on purpose: this is a
  /// last-resort guard against an absurdly dense route, not a shape-preserving simplification.
  ///
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
