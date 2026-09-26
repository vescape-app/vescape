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
/// drag that goes horizontal first is left to the control pager, so the rider can still swipe away.
/// A drag that goes vertical first holds both pagers for as long as it lasts, the way a Move hold
/// does.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/TiltScreen.kt `TiltScreen`
/// @platform-diff Only the active scene phase drives, as on Move and Lights: watchOS keeps an
///   inactive app on screen, and a stick nobody is looking at must not keep steering.
struct TiltScreen: View {
  @ObservedObject var link: PhoneLink
  /// False while the page is mid-transition; a touch then belongs to the pager, not to the board.
  let interactionEnabled: Bool
  /// Reported to the screen so a drag locks both pagers and suspends the idle return.
  let onHoldChanged: (Bool) -> Void

  @Environment(\.scenePhase) private var scenePhase

  /// The touch in flight, reset by the system if the gesture is cancelled mid-way.
  @GestureState private var touch: StickTouch?
  /// The press as a tap candidate. Plain state rather than gesture state, because the tap is decided
  /// in `onEnded`, by which point gesture state may already be reset.
  @State private var press: Press?
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
    // Simultaneous, so the control pager keeps its own swipe: a drag that goes sideways first is
    // classified as the pager's and ignored here, one that goes vertical first is the stick's.
    .simultaneousGesture(stickGesture, including: canDrive || canReset ? .all : .subviews)
    .onChange(of: touch) { _, next in
      let steering = canDrive && next?.kind == .stick
      deflection = steering ? next?.deflection ?? 0 : 0
      if steering != dragging { dragging = steering }
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
      dragging = false
      onHoldChanged(false)
    }
  }

  // MARK: - Input

  private var stickGesture: some Gesture {
    DragGesture(minimumDistance: 0)
      .updating($touch) { value, state, _ in
        var next = state ?? StickTouch()
        let dx = value.translation.width
        let dy = value.translation.height
        // Only a drag that goes vertical first is the stick's; one that goes sideways belongs to the
        // pager, and one that never moves is a tap.
        if next.kind == .pending, hypot(dx, dy) > TOUCH_SLOP {
          next.kind = abs(dy) > abs(dx) ? .stick : .pager
        }
        if next.kind == .stick { next.deflection = -dy }
        state = next
      }
      .onChanged { value in
        // A zero translation is a fresh touch-down; it also re-arms a press a cancelled gesture left.
        if press == nil || value.translation == .zero { press = Press(startedAt: value.time) }
        if hypot(value.translation.width, value.translation.height) > TOUCH_SLOP { press?.moved = true }
      }
      .onEnded { value in
        defer { press = nil }
        guard canReset, let press, !press.moved,
          value.time.timeIntervalSince(press.startedAt) <= TAP_MAX_SECONDS
        else { return }
        onTap(at: value.time)
      }
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
  enum Kind { case pending, stick, pager }

  var kind: Kind = .pending
  /// Thumb travel from touch-down, points, positive up. Only meaningful for `.stick`.
  var deflection: CGFloat = 0
}

/// A touch that may still turn out to be a tap: it has not moved past the slop, and it started when.
private struct Press {
  let startedAt: Date
  var moved = false
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

/// A press held longer than this is not a tap.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/TiltScreen.kt `TAP_MAX_MS`
private let TAP_MAX_SECONDS: TimeInterval = 0.4

/// One haptic tick per this many percent of tilt.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/TiltScreen.kt `HAPTIC_NOTCH_PERCENT`
private let HAPTIC_NOTCH_PERCENT = 5.0

/// Travel before a touch is read as a drag, and which way it went decides whose drag it is.
/// Compose supplies its own touch slop on Wear OS; SwiftUI exposes none to read.
private let TOUCH_SLOP: CGFloat = 8

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
