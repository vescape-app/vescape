import SwiftUI
import WatchConnectivity

/// The lifecycle instrumentation the port is blocked on, as a page of the control axis.
///
/// It stays deliberately dense and deliberately ugly: the runtime question it answers is what the
/// first slice existed to measure, and a finished-looking panel would make a stalled mirror look
/// healthy. Frame age is the one that answers the wrist-down question — if the app stops executing
/// while lowered, age climbs while the numbers on the gauges freeze at a value that still looks
/// plausible.
///
/// The full diagnostics page, and what Android shows on its own, arrive with the rest of the port.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/DiagnosticsScreen.kt
struct DiagnosticsPanel: View {
  @ObservedObject var link: PhoneLink
  var interactionEnabled: Bool = true

  var body: some View {
    TimelineView(.periodic(from: .now, by: 1)) { context in
      ScrollView {
        VStack(alignment: .leading, spacing: 1) {
          row("link", statusLabel)
          row("age", link.lastFrameAt.map { String(format: "%.1fs", context.date.timeIntervalSince($0)) } ?? WatchGauge.dash)
          row("rx", String(format: "%.1f / %.1f Hz", link.receivedHz, link.appliedHz))
          // The mirrored settings, until the pages that consume them exist (#487 shows the Move
          // strength, #489/#490 the navigation arrow). Without this the only proof a setting
          // reached the wrist would be a page that does not draw it yet.
          row(
            "color",
            link.settings.riderColor ?? WatchGauge.dash,
            // Drawn in the colour it names: a hex string is not something a rider can check by
            // reading, and a colour the wrist failed to parse falls back and is visibly wrong.
            value: Palette.rider(link.settings.riderColor) ?? Palette.primaryText
          )
          row("nav arrow", link.settings.navArrowEnabled ? "on" : "off")
          row("move", link.settings.boardMoveStrengthPercent.map { "\($0)%" } ?? WatchGauge.dash)
          if link.rejected > 0 {
            // Not a transient: a lane-count mismatch means the phone and the wrist were built from
            // different commits, and every frame will keep being rejected until one is reinstalled.
            row("rejected", "\(link.rejected)")
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Rim.innerInset)
      }
      // A scroll landing mid-transition belongs to the page gesture, not to this list.
      .disabled(!interactionEnabled)
    }
  }

  /// One line for the whole counterpart state. The failures are ordered — an unactivated session
  /// says nothing about reachability — so the first unmet condition is the only useful one to show.
  private var statusLabel: String {
    switch link.activation {
    case .activated: break
    case .inactive: return "inactive"
    case .notActivated: return "not activated"
    @unknown default: return "unknown"
    }
    if !link.companionInstalled { return "no phone app" }
    return link.reachable ? "reachable" : "unreachable"
  }

  private func row(_ label: String, _ text: String, value: Color = Palette.primaryText) -> some View {
    HStack(spacing: 3) {
      Text(label).foregroundStyle(Palette.secondaryText)
      Spacer(minLength: 2)
      Text(text).monospacedDigit().foregroundStyle(value)
    }
    .font(.system(size: 12))
  }
}
