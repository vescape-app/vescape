import SwiftUI

/// Frame counters, counterpart state and a bounded event log for troubleshooting from the wrist.
/// Event times use wall clock so a rider can match them to phone logs.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/DiagnosticsScreen.kt `DiagnosticsScreen`
struct DiagnosticsPanel: View {
  @ObservedObject var link: PhoneLink
  var interactionEnabled: Bool = true

  var body: some View {
    TimelineView(.periodic(from: .now, by: 1)) { context in
      ScrollView {
        VStack(alignment: .leading, spacing: 1) {
          row("link", link.statusLabel)
          row("age", link.lastFrameAt.map { String(format: "%.1fs", context.date.timeIntervalSince($0)) } ?? WatchGauge.dash)
          row("rx", String(format: "%.1f / %.1f Hz", link.receivedHz, link.appliedHz))
          row("frames", "\(link.diagnostics.framesDecoded)")
          if link.diagnostics.decodeFailures > 0 {
            // Repeated failures can indicate incompatible phone/watch frame layouts.
            row("decode fails", "\(link.diagnostics.decodeFailures)", value: Palette.warning)
          }
          // The mirrored inputs, named here because the pages that consume them draw a *result*.
          // "Nav arrow off" and "no route pushed" look identical on the nav page; they do not here.
          row(
            "color",
            link.settings.riderColor ?? WatchGauge.dash,
            // Drawn in the colour it names: a hex string is not something a rider can check by
            // reading, and a colour the wrist failed to parse falls back and is visibly wrong.
            value: Palette.rider(link.settings.riderColor) ?? Palette.primaryText
          )
          row("nav arrow", link.settings.navArrowEnabled ? "on" : "off")
          row("move", link.settings.boardMoveStrengthPercent.map { "\($0)%" } ?? WatchGauge.dash)
          row("route", link.route.map { "\($0.points.count) pts" } ?? WatchGauge.dash)
          row("weather", link.weather == nil ? WatchGauge.dash : (link.freshWeather() == nil ? "stale" : "fresh"))
          // The Lights page draws its gates as dimming, which cannot be told apart from "off".
          // These three lines are the difference, and they are how /board is verified end to end.
          row("lights", lightLabel(link.board.lightsEnabled))
          row("headlight", lightLabel(link.board.headlightsEnabled))
          row("lights ctrl", link.board.lightsControllable ? "yes" : "no")

          Divider().padding(.vertical, 3)

          if link.diagnostics.events.isEmpty {
            Text("no events yet")
              .font(.system(size: 12))
              .foregroundStyle(Palette.dimText)
          } else {
            ForEach(Array(link.diagnostics.events.enumerated()), id: \.offset) { _, event in
              eventLine(event)
            }
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Rim.innerInset)
      }
      // A scroll landing mid-transition belongs to the page gesture, not to this list.
      .disabled(!interactionEnabled)
    }
  }

  /// A dash means the board has not reported a value.
  ///
  /// @parity /watch/wearos/src/main/java/app/vescape/wear/DiagnosticsScreen.kt `boardLightLabel`
  private func lightLabel(_ value: Bool?) -> String {
    switch value {
    case true: return "on"
    case false: return "off"
    case nil: return WatchGauge.dash
    }
  }

  private func eventLine(_ event: WatchDiagnosticEvent) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 4) {
      Text(Self.clock.string(from: Date(timeIntervalSince1970: Double(event.atMs) / 1000)))
        .monospacedDigit()
        .foregroundStyle(Palette.dimText)
      Text(event.text)
        .foregroundStyle(event.warn ? Palette.warning : Palette.secondaryText)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .font(.system(size: 11))
  }

  private func row(_ label: String, _ text: String, value: Color = Palette.primaryText) -> some View {
    HStack(spacing: 3) {
      Text(label).foregroundStyle(Palette.secondaryText)
      Spacer(minLength: 2)
      Text(text).monospacedDigit().foregroundStyle(value)
    }
    .font(.system(size: 12))
  }

  /// Wall clock, seconds included: the ring is read against a phone log, and minute precision would
  /// not separate a reconnect from the flap that caused it.
  private static let clock: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "HH:mm:ss"
    return formatter
  }()
}
