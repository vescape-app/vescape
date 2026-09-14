import SwiftUI

/// Condition slug into the glyph that draws it.
///
/// Wear OS ships ported Phosphor drawables because Android has no system icon set worth the name.
/// watchOS has SF Symbols in the OS, drawn at the system's own weight and optical size, so the
/// wrist uses those instead of carrying a second copy of the artwork into the bundle. The slugs,
/// and therefore which condition gets which shape, are the phone's either way.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt `weatherIconRes`
/// @platform-diff Wear OS bundles Phosphor drawables; watchOS draws the equivalent SF Symbol from
///   the system set rather than shipping the same artwork twice.
func weatherSymbol(_ slug: String) -> String {
  switch slug {
  case "sun": return "sun.max"
  case "moon": return "moon.stars"
  case "cloud-sun": return "cloud.sun"
  case "cloud-moon": return "cloud.moon"
  case "cloud-fog": return "cloud.fog"
  case "cloud-rain": return "cloud.rain"
  case "cloud-snow": return "cloud.snow"
  case "cloud-lightning": return "cloud.bolt"
  // An unknown slug from a newer phone draws a plain cloud rather than nothing.
  default: return "cloud"
  }
}

/// The chance-of-rain glyph, and the one the radar page is named by.
let rainSymbol = "drop.fill"
let radarSymbol = "dot.radiowaves.left.and.right"

/// A tinted condition glyph at an explicit point size. SF Symbols scale with Dynamic Type by
/// default, which would let a rider's text size push a forecast strip into the rim gauges.
struct WeatherGlyph: View {
  let slug: String
  var size: CGFloat
  var color: Color?

  var body: some View {
    Image(systemName: weatherSymbol(slug))
      .font(.system(size: size))
      .foregroundStyle(color ?? Palette.weather(slug))
      .accessibilityHidden(true)
  }
}
