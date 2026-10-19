import SwiftUI

/// Phone-owned recent path: the phone map's 3 pt stroke, transparent-to-60% full-path gradient.
/// @platform-diff Watch trail peaks at 60% opacity to distinguish it from the route; phone uses 85%.
/// @parity /src/screens/main/map/LiveMapLayers.tsx
/// @parity /src/modules/map/constants/mapStyles.ts
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
        let points = movingTrail(points, offset: mapView.motion.offset(at: at))
        guard points.count > 1 else { return }
        // Use the phone map's full-path gradient, with a fainter watch default to separate it from the route.
        var distanceFromTip = Array(repeating: 0.0, count: points.count)
        for i in stride(from: points.count - 2, through: 0, by: -1) {
          distanceFromTip[i] = distanceFromTip[i + 1] + hypot(
            points[i + 1].eastM - points[i].eastM, points[i + 1].northM - points[i].northM
          )
        }
        let fadeM = max(1e-6, distanceFromTip[0])
        func alpha(_ i: Int) -> Double { 0.60 * min(1, max(0, 1 - distanceFromTip[i] / fadeM)) }
        let projected = points.map { map.place(eastM: $0.eastM, northM: $0.northM, margin: 0).point }
        // Replace overlapping cap pixels within an isolated trail layer. Its alpha is then
        // composited onto the map once, preserving both the fade and the planned route underneath.
        context.drawLayer { trailContext in
          trailContext.blendMode = .copy
          for i in 1..<points.count {
            guard alpha(i) > 0, distanceFromTip[i - 1] != distanceFromTip[i] else { continue }
            var path = Path()
            path.move(to: projected[i - 1])
            path.addLine(to: projected[i])
            trailContext.stroke(path, with: .linearGradient(
              Gradient(colors: [color.opacity(alpha(i - 1)), color.opacity(alpha(i))]),
              startPoint: projected[i - 1], endPoint: projected[i]
            ), style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
          }
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
  let loading: Bool
  var body: some View {
    ZStack {
      Canvas { context, size in
        context.drawRiderDot(at: WatchMapProjection.riderPoint(in: size), color: color)
      }
      if loading {
        RiderLoadingHalo(color: color)
          .frame(width: 24, height: 24)
          .offset(y: WatchMapProjection.riderDrop)
      }
    }
    .allowsHitTesting(false)
  }
}

/// A separate, small drawing surface keeps the loading animation out of the map and gauges.
/// @parity /watch/wearos/src/main/java/app/vescape/wear/RiderTrail.kt `RiderLoadingHalo`
private struct RiderLoadingHalo: View {
  let color: Color
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { timeline in
      Canvas { context, size in
        let bounds = CGRect(origin: .zero, size: size).insetBy(dx: 1, dy: 1)
        let stroke = StrokeStyle(lineWidth: 1.5, lineCap: .round)
        context.stroke(Path(ellipseIn: bounds), with: .color(color.opacity(0.18)), style: stroke)
        let angle = reduceMotion ? -90 : timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.2) / 1.2 * 360 - 90
        var arc = Path()
        arc.addArc(center: CGPoint(x: size.width / 2, y: size.height / 2), radius: bounds.width / 2,
          startAngle: .degrees(angle), endAngle: .degrees(angle + 100), clockwise: false)
        context.stroke(arc, with: .color(color), style: stroke)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Loading route")
  }
}
