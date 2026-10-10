import SwiftUI
import WatchKit

/// Remote Tilt from the wrist, driven like a drone's rate stick: touch anywhere, drag up or down, and
/// the tilt keeps changing for as long as the thumb stays deflected — faster the further it goes, up
/// to the rider's `tiltRatePercent` per second. Letting go leaves the tilt where it is: every change
/// is sent as an absolute Remote Tilt *lock*, which the phone holds until a reset, whatever happens
/// to the wrist afterwards.
///
/// A double tap resets through the phone pad's cancel, which eases back to neutral rather than
/// snapping. The first tap only arms it — a tick, an amber readout and a draining ring say the next
/// tap resets — so a stray touch never drops a tilt the rider was riding on.
///
/// The readout is the phone's commanded value from the Watch Frame, so a tilt set or cleared on the
/// phone pad shows here and is where the next drag starts. While a thumb is on the stick, and until
/// the phone reports the last lock back, it shows the wrist's own value instead so it never lags.
///
/// Vertical drags belong to this page: the vertical axis is already parked off the gauges, and a
/// drag that goes horizontal first moves the control pager with the finger, so the rider can still
/// swipe away. A drag that goes vertical first holds both pagers for as long as it lasts, the way a
/// Move hold does.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/TiltScreen.kt `TiltScreen`
/// @platform-diff Only the active scene phase drives, as on Move and Lights: watchOS keeps an
///   inactive app on screen, and a stick nobody is looking at must not keep steering.
/// @platform-diff A drivable page drives the pager's drag itself — offset live, snapped on release or
///   cancel — because on watchOS any drag gesture here takes the whole touch from the paging scroll
///   view. Wear OS leaves a sideways drag to its pager through touch slop.
struct TiltScreen: View {
  @ObservedObject var link: PhoneLink
  /// False while the page is mid-transition; a touch then belongs to the pager, not to the board.
  let interactionEnabled: Bool
  /// Reported to the screen so a drag locks both pagers and suspends the idle return.
  let onHoldChanged: (Bool) -> Void
  /// A sideways drag the stick gesture took from the control pager, points the page has followed
  /// the finger by: negative toward the next page.
  let onPageDrag: (CGFloat) -> Void
  /// That drag's end: +1 next page, -1 previous, 0 back to this one. Also sent when the system
  /// cancels the touch, so the pager never stays offset.
  let onPageRelease: (Int) -> Void

  @Environment(\.scenePhase) private var scenePhase

  /// The touch in flight, set and ended in the gesture's own callbacks so they stay in order.
  @State private var touch: StickTouch?
  /// True while the gesture is live. The system resets it when it cancels the gesture, which is
  /// the one end `onEnded` never hears about.
  @GestureState private var touching = false
  @State private var dragging = false
  /// Thumb travel from where it touched down, points, positive up.
  @State private var deflection: CGFloat = 0
  /// The wrist's own tilt while it is steering, percent.
  @State private var target: Double = 0
  /// The last lock sent, until the phone reports it back (or gives up on it).
  @State private var sentValue: Int?
  @State private var armedAt: Date?

  private var frame: WatchFrame? { link.mirror.frame }
  private var live: Bool { link.mirror.status == .live }
  private var control: WatchTiltControl { frame?.tiltControl ?? .free }
  private var nativeValue: Int? { frame?.remoteTilt }
  /// A phone without the tilt lanes drops tilt commands too, so its frames drive nothing.
  private var canDrive: Bool {
    live && nativeValue != nil && control.drivable && interactionEnabled && scenePhase == .active
  }
  /// Reset is the rider's way out and stays ungated like the phone's cancel: a stale frame or an
  /// untrusted link still takes it. Only a bound sensor, which re-takes the slot, makes it moot.
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
      // The track owns the full height, so the readout flanks it: number left, hint right.
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
    // Only while drivable: otherwise the pager swipes natively. A touch in flight keeps it, because
    // the page stops being settled as soon as a sideways drag moves it, and changing the mask cancels
    // the gesture. The tap stays separate, so a reset never waits for the drag to fail.
    .simultaneousGesture(stickGesture, including: canDrive || touch != nil ? .all : .subviews)
    .onTapGesture { if canReset { onTap(at: Date()) } }
    .onChange(of: touch) { _, next in
      let steering = canDrive && next?.kind == .stick
      deflection = steering ? next?.deflection ?? 0 : 0
      if steering != dragging { dragging = steering }
    }
    // A cancelled gesture: `onEnded` never ran, so end the touch here. A sideways one springs back
    // or lands wherever the finger had taken it, so the pager is never left between pages.
    .onChange(of: touching) { _, live in
      guard !live, let touch else { return }
      self.touch = nil
      if touch.kind == .pager { onPageRelease(pageStep(travel: touch.offset)) }
    }
    // The drag itself: integrate the stick every frame, send the lock whenever it lands on a new
    // wire value, at most every SEND_INTERVAL_MS. Cancelled when the drag ends, which is what sends
    // the last value even if it fell inside the throttle window.
    .task(id: dragging) {
      onHoldChanged(dragging)
      guard dragging else { return }
      await steer()
    }
    // Hand the readout back to the phone once it echoes the last lock — or after a grace period,
    // because a refused lock is never echoed and the wrist must not keep claiming a tilt it lost.
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

  // MARK: - Input

  /// Any drag gesture here takes the touch from the control pager on watchOS, the sideways ones
  /// too, so a drag that goes sideways first drives the pager itself. Global coordinates, because
  /// the page moves with the finger and a local translation would chase itself.
  private var stickGesture: some Gesture {
    DragGesture(minimumDistance: TOUCH_SLOP, coordinateSpace: .global)
      .updating($touching) { _, live, _ in live = true }
      .onChanged { value in
        let dx = value.translation.width
        let dy = value.translation.height
        // Classified once, on the first move past the slop: vertical is the stick's, sideways the
        // pager's.
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
        // A finger that stopped before lifting does not fling, as on the native pager; SwiftUI's
        // prediction still carries the speed of its last move.
        let flung = ended.movedAt.map { value.time.timeIntervalSince($0) < FLING_WINDOW } ?? false
        onPageRelease(pageStep(travel: flung ? value.predictedEndTranslation.width : value.translation.width))
      }
  }

  /// Where a sideways drag lands, the way the native pager decides: past half a page, counting the
  /// fling, is the next page in that direction; anything short of it springs back.
  private func pageStep(travel: CGFloat) -> Int {
    let half = WKInterfaceDevice.current().screenBounds.width / 2
    if travel <= -half { return 1 }
    if travel >= half { return -1 }
    return 0
  }

  private func onTap(at time: Date) {
    if let armedAt, time.timeIntervalSince(armedAt) * 1000 <= Double(RESET_WINDOW_MS) {
      self.armedAt = nil
      // Show neutral at once and hold it until the phone's ease reports back, so a drag started
      // mid-ease seeds from neutral, not from the tilt that was just reset.
      target = 0
      sentValue = WatchTiltStick.center
      link.sendTiltCancel()
      WKInterfaceDevice.current().play(.success)
    } else if tilted {
      // Nothing to reset at neutral, so a tap there arms nothing and says nothing.
      armedAt = time
      WKInterfaceDevice.current().play(.click)
    }
  }

  /// Runs for as long as the drag lasts; cancellation is the release.
  @MainActor
  private func steer() async {
    armedAt = nil
    // Seed from what the readout shows: right after a release or a reset the phone's value still
    // trails the wrist's, and starting from it would step the board back to where it was.
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
      // A tick per notch lets the rider count steps without looking; the end stop thuds.
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
    // A drag cut short because the page stopped being drivable says nothing the phone should act
    // on; only a thumb lifting on a live, drivable page sends its last value.
    if moved && canDrive && value != sentValue {
      link.sendTiltLock(value)
      sentValue = value
    }
  }

  // MARK: - Drawing

  /// The stick, drawn: a vertical track with the thumb's deflection as a knob, a fill from centre to
  /// knob, and — while a reset is armed — an amber ring inside the rim gauges draining to zero.
  private var stick: some View {
    let accent = canDrive ? Palette.tilt : Palette.dimText
    let fraction = min(max(deflection / STICK_FULL, -1), 1)
    return ZStack {
      Canvas { context, size in
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        // Nearly the whole height, stopping short of the rim gauges.
        let half = size.height / 2 - Rim.innerInset - TRACK_END_INSET
        let stroke = StrokeStyle(lineWidth: TRACK_STROKE, lineCap: .round)
        var track = Path()
        track.move(to: CGPoint(x: center.x, y: center.y - half))
        track.addLine(to: CGPoint(x: center.x, y: center.y + half))
        // Neutral notch across the track: where a still thumb sits.
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

  /// Why the stick is dead, or what the next touch does.
  ///
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

/// One touch on the stick page, classified once it has moved far enough to say what it is.
private struct StickTouch: Equatable {
  enum Kind { case stick, pager }

  let kind: Kind
  /// Thumb travel from touch-down, points, positive up. Only meaningful for `.stick`.
  var deflection: CGFloat = 0
  /// Sideways travel from touch-down, points, positive right. Only meaningful for `.pager`.
  var offset: CGFloat = 0
  /// When the sideways travel last changed. Only meaningful for `.pager`.
  var movedAt: Date?
}

/// Everything the echo wait re-decides on; a change to any of it restarts the wait.
private struct EchoWait: Equatable {
  let native: Int?
  let dragging: Bool
  let sent: Int?
}

/// Nothing moves inside this: a resting thumb must not creep.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/TiltScreen.kt `STICK_DEADZONE`
private let STICK_DEADZONE: CGFloat = 8

/// Deflection at which the stick reaches the rider's full rate.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/TiltScreen.kt `STICK_FULL`
private let STICK_FULL: CGFloat = 60

/// Lock spacing while dragging; the phone's own tilt tick is 100 ms, so faster buys nothing.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/TiltScreen.kt `SEND_INTERVAL_MS`
private let SEND_INTERVAL_MS: Int64 = 100

/// How long the wrist keeps showing an un-echoed lock before trusting the phone's value again.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/TiltScreen.kt `LOCAL_HOLD_MS`
private let LOCAL_HOLD_MS = 1_500

/// Second-tap window after the first tap arms a reset.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/TiltScreen.kt `RESET_WINDOW_MS`
private let RESET_WINDOW_MS = 700

/// One haptic tick per this many percent of tilt.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/TiltScreen.kt `HAPTIC_NOTCH_PERCENT`
private let HAPTIC_NOTCH_PERCENT = 5.0

/// Travel before a touch is read as a drag, and which way it went decides whose drag it is.
/// Compose supplies its own touch slop on Wear OS; SwiftUI exposes none to read.
private let TOUCH_SLOP: CGFloat = 8

/// How recently a sideways drag must have moved for its release to count as a fling.
private let FLING_WINDOW: TimeInterval = 0.1

/// Stick integration step: the display's frame rate, as `withFrameMillis` paces it on Wear OS.
private let FRAME_MS = 16

private let SIDE_INSET: CGFloat = 12
/// Clear width around the track: the knob plus breathing room on each side.
private let TRACK_GAP: CGFloat = 36
private let TRACK_END_INSET: CGFloat = 14
private let READOUT_FONT_SIZE: CGFloat = 24
private let TRACK_STROKE: CGFloat = 2
private let NOTCH_HALF_WIDTH: CGFloat = 6
private let KNOB_RADIUS: CGFloat = 9
private let RESET_RING_STROKE: CGFloat = 3
private let IDLE_KNOB_ALPHA = 0.7
