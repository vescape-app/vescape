import Foundation

/// Rain radar provider contract for the wrist: where the frames live, how a frame URL is built, and
/// how far out the imagery reaches on the ground.
///
/// **Why the watch fetches this itself.** ADR-0019 makes the wrist a mirror of *board* state; radar
/// frames are not board state. They are public imagery, a dozen PNGs per refresh, worthless the
/// moment they are stale, and looked at on exactly one page. Sending them over `WCSession` would
/// mean `transferFile` — a background, opportunistically-delivered queue with no cancellation once
/// a page is left, which is the wrong shape twice over: the rider would watch yesterday's frames
/// arrive, and a page they swiped past would keep spending the phone's radio. `sendMessageData` is
/// worse still: it is capped well below a frame set and drops whenever the phone is away, which is
/// exactly when a watch on Wi-Fi can still fetch. So the watch asks the provider directly over
/// whatever network it has, the same decision Wear OS made, and a watch with no network simply
/// shows nothing on this page while every other page is unaffected.
///
/// The phone still owns *where* the rider is: frames are centred on the forecast location pushed on
/// the weather channel, so the watch never touches location services.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRadar.kt
/// @parity /src/modules/weather/store/rainViewerRadarStore.ts
enum RainViewer {
  static let metaURL = "https://api.rainviewer.com/public/weather-maps.json"

  /// Frames are square PNGs centred on a coordinate rather than slippy-map tiles: one request per
  /// frame instead of a grid of them, which is what makes fetching this on a watch reasonable.
  ///
  /// `{host}{path}/{size}/{zoom}/{lat}/{lon}/{colorScheme}/{smooth}_{snow}.png`
  static let imagePx = 256

  /// Roughly a 100 km square around the rider: far enough ahead to see weather coming.
  static let zoom = 6

  /// Universal Blue, smoothed, snow shown — the same rendering the phone map overlays.
  static let colorScheme = 2
  static let options = "1_1"

  /// Past frames only, matching the phone map: nowcast frames are a forecast, not an observation.
  ///
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

/// One radar frame: when it was observed, and the provider path that renders it.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRadar.kt `RadarFrame`
struct RadarFrame: Equatable, Hashable {
  var timeSec: Int64
  var path: String
}

/// Parsed provider metadata: where the imagery lives and which frames exist right now.
struct RadarMeta: Equatable {
  var host: String
  var frames: [RadarFrame]
}

/// RainViewer publishes a new frame every ten minutes; half that is a cheap way to never miss one.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRadar.kt `RADAR_REFRESH_MS`
let radarRefreshMs: Int64 = 5 * 60 * 1_000

/// Ground metres from the rider to the edge of the radar image, which is what turns a pixel radius
/// into a distance. Web-Mercator: a pixel covers less ground the further from the equator it is, so
/// the same image is a smaller area in Oslo than in Madrid and the range rings have to follow.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchRadar.kt `radarFaceRangeM`
func radarFaceRangeM(latitude: Double) -> Double {
  equatorMetresPerPixel / Double(1 << RainViewer.zoom)
    * cos(latitude * .pi / 180)
    * Double(RainViewer.imagePx / 2)
}

/// Ground metres per pixel at zoom 0 on the equator, the constant every Web-Mercator scale is off.
private let equatorMetresPerPixel = 156_543.03392

/// A frame is centred to about a hundred metres, so only real movement re-fetches: a GPS fix
/// jittering in place would otherwise throw the whole animation away every forecast refresh.
///
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

/// Whether the imagery on the wrist still describes where the rider is and when.
///
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
