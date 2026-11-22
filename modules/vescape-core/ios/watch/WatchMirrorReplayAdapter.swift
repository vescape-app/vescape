import Foundation

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchMirrorReplayAdapter.kt
enum WatchMirrorReplayAdapter {
  static func telemetry(_ frame: WatchFrame) -> Data { WatchFrameBuilder.encode(frame) }

  static func position(origin: WatchMapPosition, eastM: Double, northM: Double) -> WatchMapPosition {
    WatchMapPosition(
      latitude: origin.latitude + northM / 110_574,
      longitude: origin.longitude + eastM / (111_320 * cos(origin.latitude * .pi / 180))
    )
  }

  static func route(_ route: WatchRoute?, origin: WatchMapPosition) -> Data? {
    guard let route, let first = route.points.first, first.eastM == 0, first.northM == 0 else { return nil }
    return WatchRouteCodec.encode(route.points.map {
      let point = position(origin: origin, eastM: $0.eastM, northM: $0.northM)
      return WatchGeoPoint(latitude: point.latitude, longitude: point.longitude)
    })
  }
}
