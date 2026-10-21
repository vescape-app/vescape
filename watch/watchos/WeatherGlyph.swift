import SwiftUI

/// Condition slug into the glyph that draws it.
///
/// Both watches draw the same ported Phosphor artwork: the slugs are the phone's, and so is the
/// shape each one gets. SF Symbols would be the cheaper route here, but the system set draws a
/// different family at a different weight, and a forecast strip that does not match the Wear OS
/// one is a second design, not a port.
///
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
  // An unknown slug from a newer phone draws a plain cloud rather than nothing.
  default: return .cloud
  }
}

/// The chance-of-rain glyph, and the one the radar page is named by.
let rainIcon = PhosphorIcon.drop

/// A readout number with its degree mark tucked against the last digit. The ° hangs off the
/// number as an overlay, so it never shifts where the digits themselves land — "19°" and "20" sit
/// on the same centre, and the mark is a tail, not part of the column.
struct DegreeNumber: View {
  let value: String
  /// The size the font was built at — the ° tuck scales with it.
  let size: CGFloat
  let color: Color
  /// Extra space past the default tuck, for scales where the mark crowds the last digit.
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

  /// Shift that leaves a hair of space between the last digit and the mark.
  private static let degreeTuck: CGFloat = 0.45
}

/// A tinted condition glyph at an explicit point size, defaulting to the colour the condition is
/// read in.
struct WeatherGlyph: View {
  let slug: String
  var size: CGFloat
  var color: Color?

  var body: some View {
    PhosphorGlyph(weatherIcon(slug), size: size, color: color ?? Palette.weather(slug))
  }
}
