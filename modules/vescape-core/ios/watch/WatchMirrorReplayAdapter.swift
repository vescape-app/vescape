import Foundation

/// Fixture models enter the same byte decoder as live phone delivery.
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMirrorReplayAdapter.kt
enum WatchMirrorReplayAdapter {
  static func telemetry(_ frame: WatchFrame) -> Data { WatchFrameBuilder.encode(frame) }

  /// Fixture points are offsets from the first point at the synthetic equatorial origin. Reject a
  /// different origin instead of letting the geographic encoder silently shift the rider's frame.
  static func route(_ route: WatchRoute?) -> Data? {
    guard let route, let first = route.points.first, first.eastM == 0, first.northM == 0 else { return nil }
    return WatchRouteCodec.encode(route.points.map {
      WatchGeoPoint(latitude: $0.northM / 110_574, longitude: $0.eastM / 111_320)
    })
  }
}
