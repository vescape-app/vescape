import SwiftUI

/// @parity /watch/wearos/src/main/java/app/vescape/wear/RadarScreen.kt `RadarScreen`
struct RadarScreen: View {
  let visible: Bool
  let forecast: WatchWeather?
  var onFetchFailed: () -> Void = {}
  var distanceUnit: String = "km"
  var timeFormat: String = "24h"
  @StateObject private var radar = RadarStore()
  @State private var index = 0

  var body: some View {
    let loaded = radar.loaded

    ZStack {
      if loaded.isEmpty {
        RadarAbsentHint(hasLocation: forecast?.latitude != nil, loading: radar.loading)
      } else {
        let frameIndex = min(max(index, 0), loaded.count - 1)
        let frame = loaded[frameIndex]
        let progress = loaded.count <= 1 ? 1.0 : Double(frameIndex) / Double(loaded.count - 1)

        face(image: radar.images[frame.timeSec], progress: progress)
        RadarHeader()
        VStack {
          Spacer()
          Text(watchFormatHour(watchMinuteOfDay(epochMs: frame.timeSec * 1_000), timeFormat: timeFormat))
            .font(WatchTypography.mono(size: 12))
            .foregroundStyle(Palette.secondaryText)
            .monospacedDigit()
            .padding(.bottom, TIME_BOTTOM_INSET)
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .task(id: RadarRequest(visible: visible, latitude: forecast?.latitude, longitude: forecast?.longitude)) {
      guard visible, let latitude = forecast?.latitude, let longitude = forecast?.longitude else { return }
      let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
      guard radar.isStale(nowMs: nowMs, latitude: latitude, longitude: longitude) else { return }
      await radar.load(latitude: latitude, longitude: longitude)
      if radar.failed { onFetchFailed() }
    }
    .task(id: AnimationKey(visible: visible, count: loaded.count)) {
      guard visible, loaded.count > 1 else { return }
      while !Task.isCancelled {
        let last = index >= loaded.count - 1
        try? await Task.sleep(for: .milliseconds(last ? LOOP_HOLD_MS : FRAME_MS))
        guard !Task.isCancelled else { return }
        index = last ? 0 : index + 1
      }
    }
  }

  private func face(image: UIImage?, progress: Double) -> some View {
    GeometryReader { geometry in
      let size = geometry.size
      let side = max(size.width, size.height)
      let centre = CGPoint(x: size.width / 2, y: size.height / 2)
      let maxFraction = RING_MAX_FRACTION * min(size.width, size.height) / side
      let rings = forecast?.latitude.map { latitude -> [(Int, Double)] in
        let rangeM = radarFaceRangeM(latitude: latitude)
        return RANGE_RING_KM
          .map { ($0, Double($0) * 1_000 / rangeM) }
          .filter { $0.1 <= maxFraction }
      } ?? []

      ZStack {
        Canvas { context, canvasSize in
          context.clip(to: Rim.path(in: canvasSize, inset: 0))
          if let image {
            // @parity /watch/wearos/src/main/java/app/vescape/wear/RadarScreen.kt `RADAR_ALPHA`
            var imagery = context
            imagery.opacity = 0.75
            imagery.draw(
              Image(uiImage: image),
              in: CGRect(x: centre.x - side / 2, y: centre.y - side / 2, width: side, height: side)
            )
          }
          let ringStroke = StrokeStyle(lineWidth: 1, dash: [3, 4])
          for (_, fraction) in rings {
            let radius = side / 2 * fraction
            context.stroke(
              Path(ellipseIn: CGRect(
                x: centre.x - radius, y: centre.y - radius, width: radius * 2, height: radius * 2
              )),
              with: .color(Palette.guide),
              style: ringStroke
            )
          }
          context.fill(
            Path(ellipseIn: CGRect(
              x: centre.x - RIDER_DOT_RADIUS, y: centre.y - RIDER_DOT_RADIUS,
              width: RIDER_DOT_RADIUS * 2, height: RIDER_DOT_RADIUS * 2
            )),
            with: .color(Palette.speed)
          )
          drawTimeline(&context, size: canvasSize, progress: progress)
        }

        ForEach(rings, id: \.0) { km, fraction in
          Text(distanceUnit == "mi" ? WatchGauge.distance(Double(km) * 1000, distanceUnit: distanceUnit) : (km == rings.last?.0 ? "\(km) km" : "\(km)"))
            .font(WatchTypography.mono(size: 8))
            .foregroundStyle(Palette.dimText)
            .position(x: centre.x + side / 2 * fraction - RING_LABEL_INSET, y: centre.y)
        }
      }
    }
    .ignoresSafeArea()
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/RadarScreen.kt `drawTimeline`
  private func drawTimeline(_ context: inout GraphicsContext, size: CGSize, progress: Double) {
    let rim = Rim.path(in: size, inset: Rim.inset + TIMELINE_INSET)
    let span = Rim.Metrics(size: size, inset: Rim.inset + TIMELINE_INSET).battery
    context.stroke(
      rim.trimmedPath(from: span.full.lowerBound, to: span.full.upperBound),
      with: .color(Palette.guide),
      style: StrokeStyle(lineWidth: 1, lineCap: .butt)
    )
    let range = span.trim(progress)
    context.stroke(
      rim.trimmedPath(from: range.lowerBound, to: range.upperBound),
      with: .color(Palette.weather("cloud-rain")),
      style: StrokeStyle(lineWidth: 2, lineCap: .butt)
    )
  }
}

private struct RadarRequest: Equatable {
  let visible: Bool
  let latitude: Double?
  let longitude: Double?
}

private struct AnimationKey: Equatable {
  let visible: Bool
  let count: Int
}

private struct RadarHeader: View {
  var body: some View {
    VStack(spacing: 1) {
      PhosphorGlyph(.target, size: 12, color: Palette.weather("cloud-rain"))
      Text("Rain radar")
        .font(WatchTypography.ui(size: 9))
        .foregroundStyle(Palette.secondaryText)
      Spacer()
    }
    .padding(.top, HEADER_TOP_INSET)
  }
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/RadarScreen.kt `RadarAbsentHint`
private struct RadarAbsentHint: View {
  let hasLocation: Bool
  let loading: Bool

  var body: some View {
    VStack(spacing: 4) {
      Text(loading ? "Loading radar" : "No radar")
        .font(WatchTypography.ui(size: 15, weight: .semibold))
        .foregroundStyle(Palette.secondaryText)
      if !loading {
        Text(hasLocation ? "Watch has no network" : "Waiting for your phone")
          .font(WatchTypography.ui(size: 11))
          .foregroundStyle(Palette.dimText)
      }
    }
    .multilineTextAlignment(.center)
    .padding(.horizontal, Rim.innerInset + 6)
  }
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/RadarScreen.kt `FRAME_MS`
private let FRAME_MS = 450

private let LOOP_HOLD_MS = 1_600

private let RANGE_RING_KM = [50, 100]
private let RING_MAX_FRACTION = 0.95
private let RING_LABEL_INSET: CGFloat = 12
private let RIDER_DOT_RADIUS: CGFloat = 3
private let HEADER_TOP_INSET: CGFloat = 12
private let TIMELINE_INSET: CGFloat = 12
private let TIME_BOTTOM_INSET: CGFloat = 18
