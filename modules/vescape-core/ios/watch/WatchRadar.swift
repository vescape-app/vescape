import Foundation

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRadar.kt
/// @parity /src/modules/weather/store/rainViewerRadarStore.ts
enum RainViewer {
  static let metaURL = "https://api.rainviewer.com/public/weather-maps.json"

  static let imagePx = 256

  static let zoom = WatchMapTile.radarZoom

  static let colorScheme = 2
  static let options = "1_1"

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRadar.kt `parseMeta`
  static func parseMeta(_ body: Data) -> RadarMeta? {
    // intentional-suppression: a malformed provider response is reported to the page as "no radar"
    guard let root = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
      let host = root["host"] as? String,
      let past = (root["radar"] as? [String: Any])?["past"] as? [[String: Any]]
    else { return nil }
    let frames = past.compactMap { frame -> RadarFrame? in
      guard let time = (frame["time"] as? NSNumber)?.int64Value,
        let path = frame["path"] as? String
      else { return nil }
      return RadarFrame(timeSec: time, path: path)
    }
    return RadarMeta(host: host, frames: frames)
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRadar.kt `frameUrl`
  static func frameURL(host: String, frame: RadarFrame, latitude: Double, longitude: Double) -> String {
    "\(host)\(frame.path)/\(imagePx)/\(zoom)/\(latitude)/\(longitude)/\(colorScheme)/\(options).png"
  }
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRadar.kt `RadarFrame`
struct RadarFrame: Equatable, Hashable {
  var timeSec: Int64
  var path: String
}

struct RadarMeta: Equatable {
  var host: String
  var frames: [RadarFrame]
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRadar.kt `RADAR_REFRESH_MS`
let radarRefreshMs: Int64 = 5 * 60 * 1_000

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRadar.kt `radarFaceRangeM`
func radarFaceRangeM(latitude: Double) -> Double {
  equatorMetresPerPixel / Double(1 << RainViewer.zoom)
    * cos(latitude * .pi / 180)
    * Double(RainViewer.imagePx / 2)
}

private let equatorMetresPerPixel = 156_543.03392

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRadar.kt `roundedCentre`
func radarRoundedCentre(latitude: Double, longitude: Double) -> RadarCentre {
  RadarCentre(
    latitude: (latitude * 1_000).rounded() / 1_000,
    longitude: (longitude * 1_000).rounded() / 1_000
  )
}

struct RadarCentre: Equatable {
  var latitude: Double
  var longitude: Double
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRadar.kt `stale`
func radarIsStale(
  centre: RadarCentre?,
  fetchedAtMs: Int64,
  nowMs: Int64,
  latitude: Double,
  longitude: Double
) -> Bool {
  centre != radarRoundedCentre(latitude: latitude, longitude: longitude)
    || nowMs - fetchedAtMs > radarRefreshMs
}
