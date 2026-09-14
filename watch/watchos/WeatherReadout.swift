import SwiftUI

/// The forecast strip on the gauges page: condition glyph and temperature, with the chance of rain
/// stacked under them whenever there is one. Sized to stay quiet — a rider glancing at speed should
/// register it without it competing with a gauge, which is also why rain goes below rather than
/// beside.
///
/// Renders nothing until the phone has pushed a forecast, so the gauges page is unchanged on a
/// phone that has not seen a GPS Fix yet. Tapping it opens the weather page.
///
/// Wear OS hangs this under its own wall clock, in the gap the rim arcs leave at the top of the
/// circle. watchOS draws the system clock there and the app has no clock of its own, so the strip
/// takes the centre the rectangle leaves free between the heroes and the battery readout — the same
/// place every other gauges-page content sits.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WeatherReadout.kt `WeatherReadout`
/// @platform-diff Wear OS places the strip under its own wall clock; on watchOS the system clock
///   owns that band, so the strip sits in the free centre instead.
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

    return VStack(spacing: 1) {
      HStack(spacing: 3) {
        WeatherGlyph(slug: forecast.icon, size: ICON_SIZE, color: iconColor)
        Text("\(forecast.temperatureC)°")
          .font(.system(size: FONT_SIZE))
          .foregroundStyle(textColor)
          .monospacedDigit()
      }
      if forecast.precipitationProbability > 0 {
        // All blue, glyph and number alike: rain is one reading, not an icon with a label.
        HStack(spacing: 1) {
          Image(systemName: rainSymbol)
            .font(.system(size: DROP_SIZE))
          Text("\(forecast.precipitationProbability)%")
            .font(.system(size: RAIN_FONT_SIZE))
            .monospacedDigit()
        }
        .foregroundStyle(rainColor)
      }
    }
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

private let ICON_SIZE: CGFloat = 13
private let DROP_SIZE: CGFloat = 8
private let FONT_SIZE: CGFloat = 13
private let RAIN_FONT_SIZE: CGFloat = 9
