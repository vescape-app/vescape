import SwiftUI
import WatchKit

/// @parity /watch/wearos/src/main/java/app/vescape/wear/TiltScreen.kt `TiltScreen`
/// @platform-diff Only the active scene phase drives, as on Move and Lights: watchOS keeps an
///   inactive app on screen, and a stick nobody is looking at must not keep steering.
/// @platform-diff A drivable page drives the pager's drag itself — offset live, snapped on release or
///   cancel — because on watchOS any drag gesture here takes the whole touch from the paging scroll
///   view. Wear OS leaves a sideways drag to its pager through touch slop.
struct TiltScreen: View {
  @ObservedObject var link: PhoneLink
  let interactionEnabled: Bool
  let onHoldChanged: (Bool) -> Void
  let onPageDrag: (CGFloat) -> Void
  let onPageRelease: (Int) -> Void

  @Environment(\.scenePhase) private var scenePhase

  @State private var touch: StickTouch?
  @GestureState private var touching = false
  @State private var dragging = false
  @State private var deflection: CGFloat = 0
  @State private var target: Double = 0
  @State private var sentValue: Int?
  @State private var armedAt: Date?

  private var frame: WatchFrame? { link.mirror.frame }
  private var live: Bool { link.mirror.status == .live }
  private var control: WatchTiltControl { frame?.tiltControl ?? .free }
  private var nativeValue: Int? { frame?.remoteTilt }
  private var canDrive: Bool {
    live && nativeValue != nil && control.drivable && interactionEnabled && scenePhase == .active
  }
  private var canReset: Bool {
    nativeValue != nil && control != .sensor && interactionEnabled && scenePhase == .active
  }
  private var nativePercent: Double { nativeValue.map { WatchTiltStick.percent(value: $0) } ?? 0 }
  private var shownPercent: Double { dragging || sentValue != nil ? target : nativePercent }
  private var tilted: Bool { WatchTiltStick.rounded(shownPercent) != 0 }
  private var armed: Bool { armedAt != nil }

  private var accent: Color {
    if armed { return Palette.armed }
    if !canDrive { return Palette.dimText }
    return tilted ? Palette.tilt : Palette.primaryText
  }

  var body: some View {
    ZStack {
      stick
      HStack(spacing: TRACK_GAP) {
        VStack(alignment: .trailing, spacing: 0) {
          Text("TILT")
            .font(WatchTypography.ui(size: 9))
            .foregroundStyle(Palette.dimText)
          Text(WatchTiltStick.format(shownPercent))
            .font(WatchTypography.mono(size: READOUT_FONT_SIZE, weight: .semibold))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .foregroundStyle(accent)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        Text(caption)
          .font(WatchTypography.ui(size: 11))
          .foregroundStyle(armed ? Palette.armed : canDrive ? Palette.secondaryText : Palette.dimText)
          .multilineTextAlignment(.leading)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      .padding(.horizontal, SIDE_INSET)
      .allowsHitTesting(false)
    }
    .contentShape(Rectangle())
    .simultaneousGesture(stickGesture, including: canDrive || touch != nil ? .all : .subviews)
    .onTapGesture { if canReset { onTap(at: Date()) } }
    .onChange(of: touch) { _, next in
      let steering = canDrive && next?.kind == .stick
      deflection = steering ? next?.deflection ?? 0 : 0
      if steering != dragging { dragging = steering }
    }
    .onChange(of: touching) { _, live in
      guard !live, let touch else { return }
      self.touch = nil
      if touch.kind == .pager { onPageRelease(pageStep(travel: touch.offset)) }
    }
    .task(id: dragging) {
      onHoldChanged(dragging)
      guard dragging else { return }
      await steer()
    }
    .task(id: EchoWait(native: nativeValue, dragging: dragging, sent: sentValue)) {
      guard !dragging, let sent = sentValue else { return }
      if nativeValue == sent {
        sentValue = nil
        return
      }
      guard (try? await Task.sleep(for: .milliseconds(LOCAL_HOLD_MS))) != nil else { return }
      sentValue = nil
    }
    .task(id: armedAt) {
      guard armedAt != nil else { return }
      guard (try? await Task.sleep(for: .milliseconds(RESET_WINDOW_MS))) != nil else { return }
      armedAt = nil
    }
    .onChange(of: canDrive) { _, allowed in
      guard !allowed else { return }
      dragging = false
      deflection = 0
    }
    .onChange(of: canReset) { _, allowed in
      if !allowed { armedAt = nil }
    }
    .onDisappear {
      touch = nil
      dragging = false
      onHoldChanged(false)
      onPageRelease(0)
    }
  }

  private var stickGesture: some Gesture {
    DragGesture(minimumDistance: TOUCH_SLOP, coordinateSpace: .global)
      .updating($touching) { _, live, _ in live = true }
      .onChanged { value in
        let dx = value.translation.width
        let dy = value.translation.height
        var next = touch ?? StickTouch(kind: abs(dy) > abs(dx) ? .stick : .pager)
        switch next.kind {
        case .stick: next.deflection = -dy
        case .pager:
          if abs(dx - next.offset) >= 1 { next.movedAt = value.time }
          next.offset = dx
          onPageDrag(dx)
        }
        touch = next
      }
      .onEnded { value in
        guard let ended = touch else { return }
        touch = nil
        guard ended.kind == .pager else { return }
        let flung = ended.movedAt.map { value.time.timeIntervalSince($0) < FLING_WINDOW } ?? false
        onPageRelease(pageStep(travel: flung ? value.predictedEndTranslation.width : value.translation.width))
      }
  }

  private func pageStep(travel: CGFloat) -> Int {
    let half = WKInterfaceDevice.current().screenBounds.width / 2
    if travel <= -half { return 1 }
    if travel >= half { return -1 }
    return 0
  }

  private func onTap(at time: Date) {
    if let armedAt, time.timeIntervalSince(armedAt) * 1000 <= Double(RESET_WINDOW_MS) {
      self.armedAt = nil
      target = 0
      sentValue = WatchTiltStick.center
      link.sendTiltCancel()
      WKInterfaceDevice.current().play(.success)
    } else if tilted {
      armedAt = time
      WKInterfaceDevice.current().play(.click)
    }
  }

  @MainActor
  private func steer() async {
    armedAt = nil
    if sentValue == nil { target = nativePercent }
    sentValue = nil
    var moved = false
    var lastSent: ContinuousClock.Instant?
    var notch = notchOf(target)
    let clock = ContinuousClock()
    var last = clock.now
    while (try? await Task.sleep(for: .milliseconds(FRAME_MS))) != nil {
      let now = clock.now
      let rate = WatchTiltStick.ratePercentPerSecond(
        deflection: Double(deflection),
        deadzone: STICK_DEADZONE,
        full: STICK_FULL,
        ratePercent: link.settings.tiltRatePercent
      )
      let next = WatchTiltStick.integrate(
        percent: target,
        ratePercentPerSecond: rate,
        elapsedMs: milliseconds(now - last)
      )
      last = now
      guard next != target else { continue }
      let hitLimit = abs(next) == 100 && abs(target) != 100
      target = next
      moved = true
      let nextNotch = notchOf(next)
      if hitLimit {
        WKInterfaceDevice.current().play(next > 0 ? .directionUp : .directionDown)
      } else if nextNotch != notch {
        WKInterfaceDevice.current().play(.click)
      }
      notch = nextNotch
      let value = WatchTiltStick.value(percent: next)
      if value != sentValue, lastSent.map({ milliseconds(now - $0) >= SEND_INTERVAL_MS }) ?? true {
        link.sendTiltLock(value)
        sentValue = value
        lastSent = now
      }
    }
    let value = WatchTiltStick.value(percent: target)
    if moved && canDrive && value != sentValue {
      link.sendTiltLock(value)
      sentValue = value
    }
  }

  private var stick: some View {
    let accent = canDrive ? Palette.tilt : Palette.dimText
    let fraction = min(max(deflection / STICK_FULL, -1), 1)
    return ZStack {
      Canvas { context, size in
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        let half = size.height / 2 - Rim.innerInset - TRACK_END_INSET
        let stroke = StrokeStyle(lineWidth: TRACK_STROKE, lineCap: .round)
        var track = Path()
        track.move(to: CGPoint(x: center.x, y: center.y - half))
        track.addLine(to: CGPoint(x: center.x, y: center.y + half))
        track.move(to: CGPoint(x: center.x - NOTCH_HALF_WIDTH, y: center.y))
        track.addLine(to: CGPoint(x: center.x + NOTCH_HALF_WIDTH, y: center.y))
        context.stroke(track, with: .color(Palette.guide), style: stroke)

        let knob = CGPoint(x: center.x, y: center.y - fraction * half)
        let knobRect = CGRect(
          x: knob.x - KNOB_RADIUS, y: knob.y - KNOB_RADIUS,
          width: KNOB_RADIUS * 2, height: KNOB_RADIUS * 2
        )
        if dragging {
          var fill = Path()
          fill.move(to: center)
          fill.addLine(to: knob)
          context.stroke(fill, with: .color(accent), style: StrokeStyle(lineWidth: TRACK_STROKE * 2, lineCap: .round))
          context.fill(Path(ellipseIn: knobRect), with: .color(accent))
        } else {
          context.stroke(Path(ellipseIn: knobRect), with: .color(accent.opacity(IDLE_KNOB_ALPHA)), style: stroke)
        }
      }
      if let armedAt {
        TimelineView(.animation) { timeline in
          let remaining = 1 - timeline.date.timeIntervalSince(armedAt) * 1000 / Double(RESET_WINDOW_MS)
          GeometryReader { geometry in
            Rim.path(in: geometry.size, inset: Rim.innerInset)
              .trimmedPath(from: 0, to: min(max(remaining, 0), 1))
              .stroke(Palette.armed, style: StrokeStyle(lineWidth: RESET_RING_STROKE, lineCap: .round))
          }
        }
      }
    }
    .allowsHitTesting(false)
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/TiltScreen.kt `tiltCaption`
  private var caption: String {
    if armed { return "Tap again\nto reset" }
    if !live { return "Board not\nconnected" }
    if nativeValue == nil { return "Update\nphone app" }
    switch control {
    case .sensor: return "Sensor"
    case .move: return "Board moving"
    case .blocked: return "Link not\ntrusted"
    case .free, .manual: break
    }
    return tilted ? "Double-tap\nto reset" : "Drag up\nor down"
  }

  private func notchOf(_ percent: Double) -> Int { Int((percent / HAPTIC_NOTCH_PERCENT).rounded(.down)) }

  private func milliseconds(_ duration: Duration) -> Int64 {
    let parts = duration.components
    return parts.seconds * 1000 + parts.attoseconds / 1_000_000_000_000_000
  }
}

private struct StickTouch: Equatable {
  enum Kind { case stick, pager }

  let kind: Kind
  var deflection: CGFloat = 0
  var offset: CGFloat = 0
  var movedAt: Date?
}

private struct EchoWait: Equatable {
  let native: Int?
  let dragging: Bool
  let sent: Int?
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/TiltScreen.kt `STICK_DEADZONE`
private let STICK_DEADZONE: CGFloat = 8

/// @parity /watch/wearos/src/main/java/app/vescape/wear/TiltScreen.kt `STICK_FULL`
private let STICK_FULL: CGFloat = 60

/// @parity /watch/wearos/src/main/java/app/vescape/wear/TiltScreen.kt `SEND_INTERVAL_MS`
private let SEND_INTERVAL_MS: Int64 = 100

/// @parity /watch/wearos/src/main/java/app/vescape/wear/TiltScreen.kt `LOCAL_HOLD_MS`
private let LOCAL_HOLD_MS = 1_500

/// @parity /watch/wearos/src/main/java/app/vescape/wear/TiltScreen.kt `RESET_WINDOW_MS`
private let RESET_WINDOW_MS = 700

/// @parity /watch/wearos/src/main/java/app/vescape/wear/TiltScreen.kt `HAPTIC_NOTCH_PERCENT`
private let HAPTIC_NOTCH_PERCENT = 5.0

private let TOUCH_SLOP: CGFloat = 8

private let FLING_WINDOW: TimeInterval = 0.1

private let FRAME_MS = 16

private let SIDE_INSET: CGFloat = 12
private let TRACK_GAP: CGFloat = 36
private let TRACK_END_INSET: CGFloat = 14
private let READOUT_FONT_SIZE: CGFloat = 24
private let TRACK_STROKE: CGFloat = 2
private let NOTCH_HALF_WIDTH: CGFloat = 6
private let KNOB_RADIUS: CGFloat = 9
private let RESET_RING_STROKE: CGFloat = 3
private let IDLE_KNOB_ALPHA = 0.7
