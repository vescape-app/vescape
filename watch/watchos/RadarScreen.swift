import SwiftUI

/// Rain radar page, above the forecast. The last two hours of observed rain replay over the rider,
/// who sits pinned at the centre exactly as on the nav page, so "is that band going to hit me" is a
/// question the wrist can answer without the phone.
///
/// Three parts, in the order they are read: the imagery, the rider at the centre, and a timeline
/// along the bottom rim — the battery gauge's stretch of the rim one ring further in, filling as
/// the animation runs, with the frame's own clock time under it.
///
/// **This is the one wrist surface that fetches for itself, and it does so only while it is the
/// page on screen.** ``visible`` is the radar page being the settled vertical page, awake and not
/// in the Always On state; both the fetch and the animation hang off `task(id:)` keyed on it, so
/// swiping away, lowering the wrist or backgrounding the app cancels the in-flight request instead
/// of leaving a page nobody is looking at spending the radio.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/RadarScreen.kt `RadarScreen`
struct RadarScreen: View {
  let visible: Bool
  let forecast: WatchWeather?
  /// Reported to the wrist's event ring. The radar is the one surface that fetches on its own, so
  /// its failure is the watch's network and not the phone's link — and on the diagnostics page it
  /// has to read that way rather than as a dead mirror.
  var onFetchFailed: () -> Void = {}
  /// The rider's own colour when they picked one on the phone — the same dot every other page pins
  /// them under.
  var riderColor: Color = Palette.speed
  @StateObject private var radar = RadarStore()
  @State private var index = 0

  var body: some View {
    let loaded = radar.loaded

    ZStack {
      if loaded.isEmpty {
        RadarAbsentHint(hasLocation: forecast?.latitude != nil, loading: radar.loading)
      } else {
        // Clamped rather than reset: frames arriving mid-loop must not throw the rider back to the
        // oldest one they already watched.
        let frameIndex = min(max(index, 0), loaded.count - 1)
        let frame = loaded[frameIndex]
        let progress = loaded.count <= 1 ? 1.0 : Double(frameIndex) / Double(loaded.count - 1)

        face(image: radar.images[frame.timeSec], progress: progress)
        RadarHeader()
        VStack {
          Spacer()
          Text(watchFormatHour(watchMinuteOfDay(epochMs: frame.timeSec * 1_000)))
            .font(WatchTypography.mono(size: 12))
            .foregroundStyle(Palette.secondaryText)
            .monospacedDigit()
            .padding(.bottom, TIME_BOTTOM_INSET)
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    // Cancelled the moment the page stops being the visible one, or the rider moves: both the
    // metadata request and every frame request are awaits inside this task.
    .task(id: RadarRequest(visible: visible, latitude: forecast?.latitude, longitude: forecast?.longitude)) {
      guard visible, let latitude = forecast?.latitude, let longitude = forecast?.longitude else { return }
      let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
      guard radar.isStale(nowMs: nowMs, latitude: latitude, longitude: longitude) else { return }
      await radar.load(latitude: latitude, longitude: longitude)
      // After the await, so a load cancelled by leaving the page never reports: `failed` is already
      // false in that case, and a cancelled fetch is not a finding.
      if radar.failed { onFetchFailed() }
    }
    // Steps the state rather than a captured value: the task is not re-keyed per frame, so a
    // captured index would advance to the same frame forever.
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

  /// The imagery, square and centred on the rider, scaled so its own edge-to-edge range covers the
  /// display's long side — the rings are measured off that same side, so the scale stays honest on
  /// the rectangle. Dimmed: it is a backdrop for the rider and the timeline, not the brightest
  /// thing on a screen read in sunlight.
  private func face(image: UIImage?, progress: Double) -> some View {
    GeometryReader { geometry in
      let size = geometry.size
      let side = max(size.width, size.height)
      let centre = CGPoint(x: size.width / 2, y: size.height / 2)
      // A ring is dropped rather than clipped when it does not fit: near the poles a frame covers
      // little ground and the wide ring would be a circle drawn on the bezel.
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
            // Dim enough that the rider and the timeline stay the brightest things on the page.
            // @parity /watch/wearos/src/main/java/app/vescape/wear/RadarScreen.kt `RADAR_ALPHA`
            var imagery = context
            imagery.opacity = 0.75
            imagery.draw(
              Image(uiImage: image),
              in: CGRect(x: centre.x - side / 2, y: centre.y - side / 2, width: side, height: side)
            )
          }
          // Dashed, so a ring never reads as another gauge guide or as a coastline in the imagery
          // under it.
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
            with: .color(riderColor)
          )
          drawTimeline(&context, size: canvasSize, progress: progress)
        }

        // Out to the right of the rider: the header owns the top, and a horizontal radius keeps the
        // labels off the imagery the rider is reading ahead of them.
        ForEach(rings, id: \.0) { km, fraction in
          Text(km == rings.last?.0 ? "\(km) km" : "\(km)")
            .font(WatchTypography.mono(size: 8))
            .foregroundStyle(Palette.dimText)
            .position(x: centre.x + side / 2 * fraction - RING_LABEL_INSET, y: centre.y)
        }
      }
    }
    .ignoresSafeArea()
  }

  /// The battery gauge's stretch of the rim, one ring inside it, filling from the oldest frame to
  /// the newest. Butt caps and a hair of width, like every other line on the wrist — nothing here
  /// is drawn as a pill. Its own ring rather than the rim itself, so it never reads as another
  /// board value.
  ///
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

/// Everything a fetch depends on, in one key: the task is cancelled when the page stops being
/// visible *or* when the rider has moved somewhere the current imagery does not describe.
private struct RadarRequest: Equatable {
  let visible: Bool
  let latitude: Double?
  let longitude: Double?
}

private struct AnimationKey: Equatable {
  let visible: Bool
  let count: Int
}

/// Names the page, since a radar frame alone is not obviously one.
private struct RadarHeader: View {
  var body: some View {
    VStack(spacing: 1) {
      Image(systemName: radarSymbol)
        .font(.system(size: 12))
        .foregroundStyle(Palette.weather("cloud-rain"))
      Text("Rain radar")
        .font(WatchTypography.ui(size: 9))
        .foregroundStyle(Palette.secondaryText)
      Spacer()
    }
    .padding(.top, HEADER_TOP_INSET)
  }
}

/// Why the page is empty: the phone has not said where the rider is, or the fetch got nothing.
///
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

/// Two hours of frames in about six seconds: fast enough to read as motion, slow enough to follow.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/RadarScreen.kt `FRAME_MS`
private let FRAME_MS = 450

/// The newest frame is the one worth looking at, so the loop pauses on it before starting over.
private let LOOP_HOLD_MS = 1_600

/// Distance rings, the scale that turns a band of rain into "twenty minutes away".
private let RANGE_RING_KM = [50, 100]
private let RING_MAX_FRACTION = 0.95
private let RING_LABEL_INSET: CGFloat = 12
private let RIDER_DOT_RADIUS: CGFloat = 3
private let HEADER_TOP_INSET: CGFloat = 24
private let TIMELINE_INSET: CGFloat = 12
private let TIME_BOTTOM_INSET: CGFloat = 18
