import SwiftUI
import WatchKit

/// The board's two light switches on the wrist: the same pair the phone's board drawer shows, in
/// one swipe instead of a pocket. The centre area splits across the middle — top half LEDs, bottom
/// half headlight, a glyph per half — and reads as a state readout, not a button: the half stays
/// tinted and its glyph lit for as long as that switch is on.
///
/// A tap flips the half immediately in a pending style and fires a haptic, then settles when the
/// board's own echo lands on the board channel. Optimistic because the round trip is
/// wrist -> phone -> BLE -> echo -> Application Context, realistically several hundred milliseconds
/// and worse on a weak link; a switch that sits still that long reads as "didn't register" and gets
/// tapped again.
///
/// **The board still owns the resting state.** The local value exists only between the tap and the
/// echo, and ``pendingTimeout`` of silence reverts it. That timeout is not belt-and-braces: the
/// command rides `sendMessageData`, which has no delivery guarantee at all, and `setBoardLights` can
/// refuse with nothing to say. A tap that changed nothing must not leave a switch claiming it did,
/// so the settle is driven by the phone's echoed state and by giving up — never by assuming the
/// command arrived.
///
/// Three gates, any one of which dims both halves and makes them inert: a LIVE mirror,
/// `lightsControllable`, and both values known. The LIVE gate is what stops a stale board push from
/// lying — cold state persists by design, so a wrist that lost the phone would otherwise keep
/// offering switches over an hour-old truth.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/LightsScreen.kt `LightsScreen`
/// @platform-diff Wear OS splits the circle its rim gauges ring. Here the split is the display's own
///   rounded rectangle one step inside the rim, the same shape the route clips to, so the halves use
///   the corners the rectangle has.
struct LightsScreen: View {
  @ObservedObject var link: PhoneLink
  /// False while the page is mid-transition; a tap then belongs to the pager, not to the board.
  let interactionEnabled: Bool

  /// The rider's own edit, held only until the board echoes it or the timeout gives up on it.
  @State private var pendingLeds: Bool?
  @State private var pendingHeadlight: Bool?

  /// Discard pending edits when the wrist leaves the active phase.
  @Environment(\.scenePhase) private var scenePhase

  private var lights: WatchBoardLights { link.board }

  private var enabled: Bool {
    link.mirror.status == .live && lights.lightsControllable && lights.known
      && scenePhase == .active
  }

  private var canTap: Bool { enabled && interactionEnabled }

  private var ledsOn: Bool { pendingLeds ?? lights.lightsEnabled ?? false }
  private var headlightOn: Bool { pendingHeadlight ?? lights.headlightsEnabled ?? false }

  var body: some View {
    ZStack {
      split
      VStack(spacing: 0) {
        half(
          symbol: "lightbulb.fill",
          label: "Lights",
          on: ledsOn,
          onTap: canTap ? { flip(.leds, to: !ledsOn) } : nil
        )
        half(
          symbol: "headlight.low.beam.fill",
          label: "Headlight",
          on: headlightOn,
          onTap: canTap ? { flip(.headlight, to: !headlightOn) } : nil
        )
      }
    }
    // Any echo settles the pending edit, whichever way it went: the board's answer is the truth,
    // including when it answers with the value the rider was trying to change away from.
    .onChange(of: lights.lightsEnabled) { _, _ in pendingLeds = nil }
    .onChange(of: lights.headlightsEnabled) { _, _ in pendingHeadlight = nil }
    // Losing a gate mid-flight drops the optimistic value rather than leaving it dimmed but claimed.
    .onChange(of: enabled) { _, next in
      guard !next else { return }
      pendingLeds = nil
      pendingHeadlight = nil
    }
    .task(id: pendingLeds) {
      guard pendingLeds != nil, await sleptThroughTimeout() else { return }
      pendingLeds = nil
    }
    .task(id: pendingHeadlight) {
      guard pendingHeadlight != nil, await sleptThroughTimeout() else { return }
      pendingHeadlight = nil
    }
  }

  private func flip(_ `switch`: WatchLightsSwitch, to target: Bool) {
    WKInterfaceDevice.current().play(.click)
    switch `switch` {
    case .leds: pendingLeds = target
    case .headlight: pendingHeadlight = target
    }
    link.sendLights(`switch`, on: target)
  }

  /// True when the wait ran out, false when the task was cancelled — a cancelled task is a settled
  /// or replaced edit, and clearing the pending value then would fight whatever replaced it.
  private func sleptThroughTimeout() async -> Bool {
    (try? await Task.sleep(nanoseconds: UInt64(Self.pendingTimeout * 1_000_000_000))) != nil
  }

  /// Resting tint per half plus the divider that says the area splits in two. The tint means "this
  /// switch is on" rather than "this half is held"; a pending edit draws at a lower alpha so an
  /// unsettled tap is visibly not yet the board's answer.
  private var split: some View {
    GeometryReader { geometry in
      let shape = Rim.path(in: geometry.size, inset: Rim.innerInset)
      let accent = enabled ? Palette.lights : Palette.guide
      ZStack {
        VStack(spacing: 0) {
          Rectangle()
            .fill(accent.opacity(tintAlpha(on: ledsOn, pending: pendingLeds != nil)))
          Rectangle()
            .fill(accent.opacity(tintAlpha(on: headlightOn, pending: pendingHeadlight != nil)))
        }
        Rectangle()
          .fill(Palette.guide)
          .frame(height: Self.dividerWidth)
      }
      .clipShape(shape)
    }
    .allowsHitTesting(false)
  }

  private func tintAlpha(on: Bool, pending: Bool) -> Double {
    guard on else { return 0 }
    return pending ? Self.pendingTintAlpha : Self.onTintAlpha
  }

  private func half(symbol: String, label: String, on: Bool, onTap: (() -> Void)?) -> some View {
    let tint: Color = !enabled ? Palette.dimText : (on ? Palette.lights : Palette.secondaryText)
    return VStack(spacing: 2) {
      Image(systemName: symbol)
        .font(.system(size: Self.glyphSize))
        .foregroundStyle(tint)
      Text(label)
        .font(.system(size: 11))
        .foregroundStyle(tint)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    // The tint and the haptic are the press feedback; a highlight under the rim gauges is not.
    .contentShape(Rectangle())
    .onTapGesture { onTap?() }
    .allowsHitTesting(onTap != nil)
  }

  /// How long an unechoed tap keeps its pending value before it reverts to the board's own state.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/LightsScreen.kt `PENDING_TIMEOUT_MS`
  private static let pendingTimeout: TimeInterval = 2

  private static let glyphSize: CGFloat = 26
  private static let dividerWidth: CGFloat = 1
  private static let onTintAlpha = 0.18
  private static let pendingTintAlpha = 0.07
}
