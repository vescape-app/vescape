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

/// Phosphor's "target" mark — the crosshair circle with its aim arm — as the Wear OS radar
/// header draws it. No SF Symbol matches that shape, so the wrist carries the geometry natively
/// rather than an approximation from the system set.
///
/// @parity /watch/wearos/src/main/res/drawable/ic_ph_target.xml
/// @platform-diff Wear OS ships the Phosphor vector drawable directly; watchOS re-draws its
///   geometry with SwiftUI shapes instead of carrying the artwork into the bundle.
struct RadarTargetGlyph: View {
  var color: Color
  var size: CGFloat

  private var s: CGFloat { size / 256 }

  var body: some View {
    ZStack {
      Circle()
        .fill(color.opacity(0.2))
        .frame(width: 96 * s, height: 96 * s)
      Circle()
        .stroke(color, lineWidth: 16 * s)
        .frame(width: 112 * s, height: 112 * s)
      Circle()
        .stroke(color, lineWidth: 16 * s)
        .frame(width: 208 * s, height: 208 * s)
    }
    .overlay {
      Capsule()
        .fill(color)
        .frame(width: 136 * s, height: 16 * s)
        .rotationEffect(.degrees(-45))
        .offset(x: 53.66 * s, y: -42.35 * s)
    }
    .frame(width: size, height: size)
  }
}

/// A readout number with its degree mark tucked against the last digit. The ° hangs off the
/// number as an overlay, so it never shifts where the digits themselves land — "19°" and "20" sit
/// on the same centre, and the mark is a tail, not part of the column.
struct DegreeNumber: View {
  let value: String
  /// The size the font was built at — the ° tuck scales with it.
  let size: CGFloat
  let color: Color

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
          .offset(x: size * Self.degreeTuck)
      }
  }

  /// Shift that leaves a hair of space between the last digit and the mark.
  private static let degreeTuck: CGFloat = 0.45
}

/// A tinted condition glyph at an explicit point size. SF Symbols scale with Dynamic Type by
/// default, which would let a rider's text size push a forecast strip into the rim gauges.
struct WeatherGlyph: View {
  let slug: String
  var size: CGFloat
  var color: Color?

  var body: some View {
    Image(systemName: weatherSymbol(slug))
      // Square-bounded rather than font-sized: SF Symbols of one condition family draw at
      // different glyph sizes at the same point size, and a forecast row reads ragged unless
      // every condition fills the same box.
      .resizable()
      .scaledToFit()
      .frame(width: size, height: size)
      .foregroundStyle(color ?? Palette.weather(slug))
      .accessibilityHidden(true)
  }
}
