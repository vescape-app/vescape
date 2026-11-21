import SwiftUI
import WatchKit

/// @parity /watch/wearos/src/main/java/app/vescape/wear/LightsScreen.kt `LightsScreen`
/// @platform-diff Wear OS splits the circle its rim gauges ring. Here the split is the display's own
///   rounded rectangle one step inside the rim, the same shape the route clips to, so the halves use
///   the corners the rectangle has.
struct LightsScreen: View {
  @ObservedObject var link: PhoneLink
  let interactionEnabled: Bool

  @State private var pendingLeds: Bool?
  @State private var pendingHeadlight: Bool?

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
          icon: .lightbulb,
          label: "Lights",
          on: ledsOn,
          onTap: canTap ? { flip(.leds, to: !ledsOn) } : nil
        )
        half(
          icon: .headlights,
          label: "Headlight",
          on: headlightOn,
          onTap: canTap ? { flip(.headlight, to: !headlightOn) } : nil
        )
      }
    }
    .onChange(of: lights.lightsEnabled) { _, _ in pendingLeds = nil }
    .onChange(of: lights.headlightsEnabled) { _, _ in pendingHeadlight = nil }
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

  private func sleptThroughTimeout() async -> Bool {
    (try? await Task.sleep(nanoseconds: UInt64(Self.pendingTimeout * 1_000_000_000))) != nil
  }

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

  private func half(icon: PhosphorIcon, label: String, on: Bool, onTap: (() -> Void)?) -> some View {
    let tint: Color = !enabled ? Palette.dimText : (on ? Palette.lights : Palette.secondaryText)
    return VStack(spacing: 2) {
      PhosphorGlyph(icon, size: Self.glyphSize, color: tint)
      Text(label)
        .font(WatchTypography.ui(size: 11))
        .foregroundStyle(tint)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .contentShape(Rectangle())
    .onTapGesture { onTap?() }
    .allowsHitTesting(onTap != nil)
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/LightsScreen.kt `PENDING_TIMEOUT_MS`
  private static let pendingTimeout: TimeInterval = 2

  private static let glyphSize: CGFloat = 26
  private static let dividerWidth: CGFloat = 1
  private static let onTintAlpha = 0.18
  private static let pendingTintAlpha = 0.07
}
