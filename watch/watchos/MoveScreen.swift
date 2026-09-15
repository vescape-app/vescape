import SwiftUI
import WatchKit

/// Board Move from the wrist: the centre area split across the middle, top half forward, bottom
/// half back — the same order as the phone's Move board card. It has no ring of its own; the rim
/// gauges stay pinned behind every page, and duty and speed climbing on those arcs is the truest
/// feedback that the board is actually rolling.
///
/// Hold to roll, release to stop. The same action as the phone's Move card, reaching the same
/// native Board Move stream (ADR-0033), so the board behaves identically whichever the rider
/// presses — including the strength, which is the phone's setting and is never applied here. The
/// wrist sends a direction and nothing else.
///
/// **A hold is a stream of ticks, not a press/release pair.** Releasing sends an immediate stop, but
/// the stop the rider's safety rests on is the phone's dead-man: ticks stop, the board stops. A
/// wrist that walks out of range, dies, or has its app killed mid-hold cannot leave a board rolling,
/// because none of those can keep ticking. Nothing here waits for an acknowledgement, and nothing
/// here would be safer if it did.
///
/// The press is read through `@GestureState`, which is the point rather than a convenience: SwiftUI
/// resets it to its initial value when a gesture is cancelled — a drag the pager claims, a finger
/// that leaves the screen, a view that goes away — so every way a press can end without an `onEnded`
/// still ends the hold. That is a second layer under the phone's timeout, not a replacement for it.
///
/// Only enabled on a LIVE mirror. A stale or absent frame means the phone has no fresh board
/// telemetry, and a Move nobody can see the result of is not one to offer.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/MoveScreen.kt `MoveScreen`
/// @platform-diff Wear OS splits the circle its rim gauges ring. Here the split is the display's own
///   rounded rectangle one step inside the rim, the same shape Lights and the route clip to.
struct MoveScreen: View {
  @ObservedObject var link: PhoneLink
  /// False while the page is mid-transition; a press then belongs to the pager, not to the board.
  let interactionEnabled: Bool
  /// Reported to the screen so a held Move locks both pagers and suspends the idle return. A hold
  /// must not be read as a page swipe, and must never end because the page moved under it.
  let onHoldChanged: (Bool) -> Void

  /// The half under the rider's finger. Automatically cleared by SwiftUI on cancellation.
  @GestureState private var pressed: MoveDirection?

  private var enabled: Bool { link.mirror.status == .live }
  private var canMove: Bool { enabled && interactionEnabled }

  /// Losing a gate mid-hold ends the hold: a stream started while LIVE must not keep ticking at a
  /// phone that can no longer show what the board is doing.
  private var held: MoveDirection? { canMove ? pressed : nil }

  var body: some View {
    ZStack {
      split
      VStack(spacing: 0) {
        half(.forward)
        half(.backward)
      }
      CenterLabel(enabled: enabled, strengthPercent: link.settings.boardMoveStrengthPercent)
    }
    // The tick loop *is* the hold. It restarts whenever the direction changes and is cancelled the
    // instant it clears, which is what sends the release.
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
      // Cancellation is the release. Sending it from here as well as from the next task run means
      // a view teardown mid-hold still asks for a stop rather than only letting the dead-man have it.
      link.sendMove(0)
      WKInterfaceDevice.current().play(.stop)
    }
    .onDisappear {
      onHoldChanged(false)
      link.sendMove(0)
    }
  }

  /// Held-half feedback inside the pinned rim gauges: a dim tint on whichever half is held, and the
  /// divider that says the area splits in two.
  private var split: some View {
    GeometryReader { geometry in
      let shape = Rim.path(in: geometry.size, inset: Rim.innerInset)
      let accent = enabled ? Palette.speed : Palette.guide
      ZStack {
        VStack(spacing: 0) {
          Rectangle().fill(accent.opacity(held == .forward ? Self.heldTintAlpha : 0))
          Rectangle().fill(accent.opacity(held == .backward ? Self.heldTintAlpha : 0))
        }
        Rectangle()
          .fill(Palette.guide)
          .frame(height: Self.dividerWidth)
      }
      .clipShape(shape)
    }
    .allowsHitTesting(false)
  }

  private func half(_ direction: MoveDirection) -> some View {
    Image(systemName: direction.symbol)
      .font(.system(size: Self.glyphSize, weight: .semibold))
      .foregroundStyle(enabled ? Palette.speed : Palette.dimText)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      // The tint and the haptic are the press feedback; a highlight under the rim gauges is not.
      .contentShape(Rectangle())
      .gesture(
        DragGesture(minimumDistance: 0)
          .updating($pressed) { _, state, _ in state = direction }
      )
      .allowsHitTesting(canMove)
  }

  private static let glyphSize: CGFloat = 30
  private static let dividerWidth: CGFloat = 1
  private static let heldTintAlpha = 0.18
}

/// Forward is the top half, backward the bottom — the same order as the phone's Move board card.
/// `wire` is the direction byte, not an input value: the phone turns it into motor output.
///
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

  var symbol: String {
    switch self {
    case .forward: return "chevron.up"
    case .backward: return "chevron.down"
    }
  }
}

/// What the centre says when nothing is held: the phone's strength, or why there is nothing to hold.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/MoveScreen.kt `CenterLabel`
private struct CenterLabel: View {
  let enabled: Bool
  let strengthPercent: Int?

  var body: some View {
    Text(text)
      .font(.system(size: 11))
      .foregroundStyle(enabled ? Palette.secondaryText : Palette.dimText)
      .multilineTextAlignment(.center)
      .allowsHitTesting(false)
  }

  private var text: String {
    guard enabled else { return "Board not connected" }
    guard let strengthPercent else { return "Hold to move" }
    return "\(strengthPercent)%"
  }
}
