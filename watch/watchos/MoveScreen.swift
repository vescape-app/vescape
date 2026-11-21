import SwiftUI
import WatchKit

/// @parity /watch/wearos/src/main/java/app/vescape/wear/MoveScreen.kt `MoveScreen`
/// @platform-diff Wear OS splits the circle its rim gauges ring. Here the split is the display's own
///   rounded rectangle one step inside the rim, the same shape Lights and the route clip to.
struct MoveScreen: View {
  @ObservedObject var link: PhoneLink
  let interactionEnabled: Bool
  let onHoldChanged: (Bool) -> Void

  @State private var pressed: MoveDirection?

  @Environment(\.scenePhase) private var scenePhase

  private var enabled: Bool { link.mirror.status == .live }
  private var canMove: Bool { enabled && interactionEnabled && scenePhase == .active }

  private var held: MoveDirection? { canMove ? pressed : nil }

  var body: some View {
    ZStack {
      split
      VStack(spacing: 0) {
        half(.forward)
        half(.backward)
      }
      CenterLabel(
        enabled: enabled,
        strengthPercent: link.settings.boardMoveStrengthPercent,
        clearsTilt: link.mirror.frame?.tiltControl == .manual
      )
    }
    .task(id: held) {
      onHoldChanged(held != nil)
      guard let held else {
        link.sendMove(0)
        return
      }
      WKInterfaceDevice.current().play(.start)
      while !Task.isCancelled {
        link.sendMove(held.wire)
        guard (try? await Task.sleep(for: .milliseconds(watchMoveRepeatMs))) != nil else { break }
      }
      link.sendMove(0)
      WKInterfaceDevice.current().play(.stop)
    }
    .onChange(of: canMove) { _, allowed in
      if !allowed { pressed = nil }
    }
    .onDisappear {
      pressed = nil
      onHoldChanged(false)
      link.sendMove(0)
    }
  }

  private var split: some View {
    GeometryReader { geometry in
      let shape = Rim.path(in: geometry.size, inset: Rim.innerInset)
      let accent = enabled ? Palette.speed : Palette.guide
      ZStack {
        VStack(spacing: 0) {
          Rectangle().fill(accent.opacity(held == .forward ? Self.heldTintAlpha : 0))
          Rectangle().fill(accent.opacity(held == .backward ? Self.heldTintAlpha : 0))
        }
        HStack(spacing: geometry.size.width * Self.dividerGapShare) {
          Rectangle().fill(Palette.guide)
          Rectangle().fill(Palette.guide)
        }
        .frame(height: Self.dividerWidth)
      }
      .clipShape(shape)
    }
    .allowsHitTesting(false)
  }

  private func half(_ direction: MoveDirection) -> some View {
    Button(action: {}) {
      Text(direction.glyph)
        .font(.system(size: Self.glyphSize, weight: .semibold))
        .foregroundStyle(enabled ? Palette.speed : Palette.dimText)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
    }
    .buttonStyle(MovePressStyle { down in
      if down && canMove {
        pressed = direction
      } else if pressed == direction {
        pressed = nil
      }
    })
    .disabled(!canMove)
  }

  private static let glyphSize: CGFloat = 30
  private static let dividerWidth: CGFloat = 1
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MoveScreen.kt `DIVIDER_GAP_FRACTION`
  private static let dividerGapShare: CGFloat = 0.5
  private static let heldTintAlpha = 0.18
}

private struct MovePressStyle: ButtonStyle {
  let onPressChanged: (Bool) -> Void

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .onChange(of: configuration.isPressed) { _, down in onPressChanged(down) }
      .onDisappear { onPressChanged(false) }
  }
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/MoveScreen.kt `DIRECTION_FORWARD`
enum MoveDirection: Equatable {
  case forward
  case backward

  var wire: Int {
    switch self {
    case .forward: return 1
    case .backward: return -1
    }
  }

  /// @parity /watch/wearos/src/main/java/app/vescape/wear/MoveScreen.kt `MoveScreen`
  var glyph: String {
    switch self {
    case .forward: return "\u{25B2}"
    case .backward: return "\u{25BC}"
    }
  }
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/MoveScreen.kt `CenterLabel`
private struct CenterLabel: View {
  let enabled: Bool
  let strengthPercent: Int?
  let clearsTilt: Bool

  var body: some View {
    VStack(spacing: 0) {
      Text(text)
        .font(WatchTypography.ui(size: 11))
        .foregroundStyle(enabled ? Palette.secondaryText : Palette.dimText)
      if enabled && clearsTilt {
        Text("Clears tilt")
          .font(WatchTypography.ui(size: 9))
          .foregroundStyle(Palette.armed)
      }
    }
    .multilineTextAlignment(.center)
    .allowsHitTesting(false)
  }

  private var text: String {
    guard enabled else { return "Board not connected" }
    guard let strengthPercent else { return "Hold to move" }
    return "\(strengthPercent)%"
  }
}
