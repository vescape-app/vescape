import SwiftUI

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WeatherReadout.kt `WeatherReadout`
/// @platform-diff Wear OS places the strip under its own wall clock; on watchOS the system clock
struct WeatherReadout: View {
  let forecast: WatchWeather?
  var ambient: AmbientMode = .off
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
        DegreeNumber(value: "\(forecast.temperatureC)", size: FONT_SIZE, color: textColor, extraGap: 2)
      }
      if forecast.precipitationProbability > 0 {
        HStack(spacing: 1) {
          PhosphorGlyph(rainIcon, size: DROP_SIZE, color: rainColor)
          Text("\(forecast.precipitationProbability)%")
            .font(WatchTypography.mono(size: RAIN_FONT_SIZE))
            .monospacedDigit()
        }
        .foregroundStyle(rainColor)
      }
    }
    .fixedSize()
    .contentShape(Rectangle())
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
