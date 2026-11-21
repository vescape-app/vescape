import SwiftUI

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt `weatherIconRes`
func weatherIcon(_ slug: String) -> PhosphorIcon {
  switch slug {
  case "sun": return .sun
  case "moon": return .moonStars
  case "cloud-sun": return .cloudSun
  case "cloud-moon": return .cloudMoon
  case "cloud-fog": return .cloudFog
  case "cloud-rain": return .cloudRain
  case "cloud-snow": return .cloudSnow
  case "cloud-lightning": return .cloudLightning
  default: return .cloud
  }
}

let rainIcon = PhosphorIcon.drop

struct DegreeNumber: View {
  let value: String
  let size: CGFloat
  let color: Color
  var extraGap: CGFloat = 0

  var body: some View {
    Text(value)
      .font(WatchTypography.mono(size: size))
      .foregroundStyle(color)
      .monospacedDigit()
      .fixedSize()
      .overlay(alignment: .trailing) {
        Text("°")
          .font(WatchTypography.mono(size: size))
          .foregroundStyle(color)
          .fixedSize()
          .offset(x: size * Self.degreeTuck + extraGap)
      }
  }

  private static let degreeTuck: CGFloat = 0.45
}

struct WeatherGlyph: View {
  let slug: String
  var size: CGFloat
  var color: Color?

  var body: some View {
    PhosphorGlyph(weatherIcon(slug), size: size, color: color ?? Palette.weather(slug))
  }
}
