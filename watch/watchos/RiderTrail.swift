import SwiftUI

/// Phone-owned recent path, fading toward its oldest fix like the main map.
/// @parity /watch/wearos/src/main/java/app/vescape/wear/RiderTrail.kt `RiderTrail`
struct RiderTrail: View {
  let points: [WatchTrailPoint]
  let mapView: WatchMapView
  let mapMoving: Bool
  let color: Color

  var body: some View {
    TimelineView(.animation(paused: !mapMoving)) { timeline in
      let at = mapMoving ? timeline.date : .distantFuture
      Canvas { context, size in
        let map = WatchMapProjection(size: size, spanM: mapView.spanM(at: at), courseDeg: mapView.courseDeg(at: at))
        context.clip(to: Rim.path(in: size, inset: Rim.inset))
        guard points.count > 1 else { return }
        for i in 1..<points.count {
          let a = map.place(eastM: points[i - 1].eastM, northM: points[i - 1].northM, margin: 0)
          let b = map.place(eastM: points[i].eastM, northM: points[i].northM, margin: 0)
          var path = Path()
          path.move(to: a.point)
          path.addLine(to: b.point)
          context.stroke(path, with: .color(color.opacity(0.85 * Double(i) / Double(points.count - 1))),
            style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
        }
      }
    }
    .allowsHitTesting(false)
  }
}

/// One position ring above paths and other Riders, whether or not Navigation is active.
/// @parity /watch/wearos/src/main/java/app/vescape/wear/RiderTrail.kt `RiderPosition`
struct RiderPosition: View {
  let color: Color
  var body: some View {
    Canvas { context, size in
      context.drawRiderDot(at: WatchMapProjection.riderPoint(in: size), color: color)
    }
    .allowsHitTesting(false)
  }
}
