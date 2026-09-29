import CoreGraphics
import Foundation

/// The nav route's heading-up projection, in points: the Rider sits `riderDrop` below the display
/// centre, their course points up, and the clamped span of metres fits the display's shorter side
/// minus `edgeInset`. The route line and the Group Ride dots share it, so a Rider on the route is
/// drawn on it.
///
/// Shared with the wrist (`watch/watchos/` symlinks this file) so the placement math is tested here.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `HeadingUpMap`
struct WatchMapProjection {
  /// The Rider sits this far below the centre, so more of the map is ahead than behind.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/NavRoute.kt `RIDER_DROP`
  static let riderDrop: CGFloat = 34
  /// Display margin the map's span is fitted inside.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/NavRoute.kt `ROUTE_EDGE_INSET`
  static let edgeInset: CGFloat = 24
  /// Fallback metres across the display until the phone publishes its camera span.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/NavRoute.kt `DEFAULT_ROUTE_SPAN_M`
  static let defaultSpanM = 600.0
  static let minSpanM = 150.0
  static let maxSpanM = 2_000.0

  /// The phone map's span, clamped to what a wrist can draw, or the fallback.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/NavRoute.kt `clampRouteSpanM`
  static func clampedSpanM(_ spanM: Double?) -> Double {
    min(maxSpanM, max(minSpanM, spanM ?? defaultSpanM))
  }

  let size: CGSize
  let courseDeg: Double
  private let scale: Double

  init(size: CGSize, spanM: Double?, courseDeg: Double) {
    self.size = size
    self.courseDeg = courseDeg
    scale = (min(size.width, size.height) - Self.edgeInset) / Self.clampedSpanM(spanM)
  }

  var centre: CGPoint { CGPoint(x: size.width / 2, y: size.height / 2) }
  var rider: CGPoint { CGPoint(x: centre.x, y: centre.y + Self.riderDrop) }
  /// Half the shorter side: the circle "in range" is measured against, on a round or square face.
  var faceRadius: CGFloat { min(size.width, size.height) / 2 }

  /// Place a point `eastM`/`northM` metres from the Rider. In range = inside `faceRadius - margin`.
  func place(eastM: Double, northM: Double, margin: CGFloat) -> WatchMapPlacement {
    let rad = relativeBearingDeg(eastM: eastM, northM: northM, courseDeg: courseDeg) * .pi / 180
    let direction = CGVector(dx: sin(rad), dy: -cos(rad))
    let reach = (eastM * eastM + northM * northM).squareRoot() * scale
    let point = CGPoint(x: rider.x + direction.dx * reach, y: rider.y + direction.dy * reach)
    let fromCentre = hypot(point.x - centre.x, point.y - centre.y)
    return WatchMapPlacement(point: point, direction: direction, inRange: fromCentre <= faceRadius - margin)
  }
}

/// One point placed on the heading-up map. `direction` is the unit ray from the Rider towards it in
/// screen space, so a caller drawing something on the display edge (#527) has the ray already.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `MapPlacement`
struct WatchMapPlacement: Equatable {
  let point: CGPoint
  let direction: CGVector
  /// Inside the display, clear of the rim gauges by the placing caller's margin.
  let inRange: Bool
}

/// Bearing of an east/north offset relative to `courseDeg`, degrees clockwise in 0..<360: 0
/// straight ahead, 90 right, 180 behind.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `relativeBearingDeg`
func relativeBearingDeg(eastM: Double, northM: Double, courseDeg: Double) -> Double {
  let absolute = atan2(eastM, northM) * 180 / .pi
  return ((absolute - courseDeg).truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
}

/// The joined Group Ride as the wrist knows it: the latest Group Ride Frame, with the Rider's course
/// held across frames that carry none, so a stopped Rider keeps the last heading-up direction.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `WatchGroupRide`
struct WatchGroupRide: Equatable {
  /// The Rider's course, degrees clockwise from north; 0 (north-up) until one has ever arrived.
  var courseDeg: Double
  var spanM: Double
  var riders: [GroupRideFrameRider]

  /// The next state for an arriving frame, keeping `previous`'s course when the frame has none.
  static func accepting(_ frame: GroupRideFrame, previous: WatchGroupRide?) -> WatchGroupRide {
    WatchGroupRide(
      courseDeg: frame.courseDeg ?? previous?.courseDeg ?? 0,
      spanM: frame.spanM,
      riders: frame.riders
    )
  }

  /// Where `rider` is relative to the Rider's travel direction: 0 ahead, 90 right, 180 behind.
  func bearingDeg(of rider: GroupRideFrameRider) -> Double {
    relativeBearingDeg(eastM: rider.eastM, northM: rider.northM, courseDeg: courseDeg)
  }
}

/// Three missed 1 Hz frames and the group is gone from the wrist.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/GroupRide.kt `GROUP_RIDE_TIMEOUT_MS`
let GROUP_RIDE_TIMEOUT_MS: Int64 = 3_500
