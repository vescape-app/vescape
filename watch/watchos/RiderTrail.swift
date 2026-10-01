import SwiftUI

/// Phone-owned recent path, fading by travelled distance within a quarter of the map span.
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
        // Fade over nearby travelled metres, not sample count across kilometres of offscreen history.
        var distanceFromTip = Array(repeating: 0.0, count: points.count)
        for i in stride(from: points.count - 2, through: 0, by: -1) {
          distanceFromTip[i] = distanceFromTip[i + 1] + hypot(
            points[i + 1].eastM - points[i].eastM, points[i + 1].northM - points[i].northM
          )
        }
        let fadeM = max(1, min(distanceFromTip[0], mapView.spanM(at: at) * 0.25))
        func alpha(_ i: Int) -> Double { 0.85 * min(1, max(0, 1 - distanceFromTip[i] / fadeM)) }
        let projected = points.map { map.place(eastM: $0.eastM, northM: $0.northM, margin: 0).point }
        var casing = Path()
        casing.addLines(projected)
        // Suppress an overlapping planned route under the ridden path, including its faded tail.
        context.stroke(casing, with: .color(.black), style: StrokeStyle(lineWidth: 7, lineCap: .round, lineJoin: .round))
        for i in 1..<points.count {
          guard alpha(i) > 0, distanceFromTip[i - 1] != distanceFromTip[i] else { continue }
          var path = Path()
          path.move(to: projected[i - 1])
          path.addLine(to: projected[i])
          context.stroke(path, with: .linearGradient(
            Gradient(colors: [color.opacity(alpha(i - 1)), color.opacity(alpha(i))]),
            startPoint: projected[i - 1], endPoint: projected[i]
          ), style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
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
