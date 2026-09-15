import SwiftUI

/// Compact forecast above speed: condition and temperature, with rain below.
///
/// Renders nothing until the phone has pushed a forecast, so the gauges page is unchanged on a
/// phone that has not seen a GPS Fix yet. Tapping it opens the weather page.
///
/// Wear OS hangs this under its own wall clock, in the gap the rim arcs leave at the top of the
/// circle. watchOS puts the strip inside the top-left rim, above the speed number and to the left
/// of the system clock.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WeatherReadout.kt `WeatherReadout`
/// @platform-diff Wear OS places the strip under its own wall clock; on watchOS the system clock
///   sits at the upper right, so the strip sits above speed at the upper left.
struct WeatherReadout: View {
  let forecast: WatchWeather?
  var ambient: AmbientMode = .off
  /// Nil while another page owns the screen: a tap target here would otherwise swallow drags meant
  /// for the pagers.
  var onTap: (() -> Void)?

  var body: some View {
    if let forecast {
      strip(forecast)
    }
  }

  private func strip(_ forecast: WatchWeather) -> some View {
    let iconColor = ambient.active ? Palette.dimText : Palette.weather(forecast.icon)
    let textColor = ambient.skeleton(Palette.secondaryText)
    let rainColor = ambient.active ? Palette.dimText : Palette.weather("cloud-rain")

    return VStack(alignment: .trailing, spacing: 1) {
      HStack(spacing: 0) {
        WeatherGlyph(slug: forecast.icon, size: ICON_SIZE, color: iconColor)
        // Tucked °, so the temp's trailing edge is its last digit and the rain row below hangs
        // flush with it instead of clearing the mark's advance width.
        DegreeNumber(value: "\(forecast.temperatureC)", size: FONT_SIZE, color: textColor)
      }
      if forecast.precipitationProbability > 0 {
        // All blue, glyph and number alike: rain is one reading, not an icon with a label.
        HStack(spacing: 1) {
          Image(systemName: rainSymbol)
            .font(.system(size: DROP_SIZE))
          Text("\(forecast.precipitationProbability)%")
            .font(WatchTypography.mono(size: RAIN_FONT_SIZE))
            .monospacedDigit()
        }
        .foregroundStyle(rainColor)
      }
    }
    .fixedSize()
    .contentShape(Rectangle())
    // A disabled tap gesture still installs a gesture recognizer, so the modifier has to be absent
    // rather than switched off.
    .modifier(OptionalTap(action: onTap))
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(forecast.label)
    .accessibilityValue("\(forecast.temperatureC) degrees")
  }
}

private struct OptionalTap: ViewModifier {
  let action: (() -> Void)?

  @ViewBuilder
  func body(content: Content) -> some View {
    if let action {
      content.onTapGesture(perform: action)
    } else {
      content
    }
  }
}

private let ICON_SIZE: CGFloat = 10
private let DROP_SIZE: CGFloat = 7
private let FONT_SIZE: CGFloat = 11
private let RAIN_FONT_SIZE: CGFloat = 8
