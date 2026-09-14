import SwiftUI

/// Forecast page above the gauges. Current conditions are the hero; every hour the phone sent is
/// available in a horizontal strip, matching the phone forecast without fighting the vertical page
/// gesture back to telemetry.
///
/// Structure is carried by hairlines rather than boxes: a rule that fades out at both ends separates
/// the hero from the strip, and the next sun time closes the page under it. Everything is a 1 pt
/// guide stroke or a tinted glyph — no fills, per `docs/design.md`.
///
/// Read-only, like every wrist surface: the phone owns the forecast and there is no way to ask it
/// for a fresher one from here (ADR-0019 keeps the mirror one-way for data).
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WeatherScreen.kt `WeatherScreen`
struct WeatherScreen: View {
  let forecast: WatchWeather?
  /// Whether the phone has ever pushed a forecast. A forecast that arrived and then aged out is a
  /// different thing from one that never came, and the rider is told which.
  var everReceived: Bool = false

  @ViewBuilder
  var body: some View {
    if let forecast {
      content(forecast)
    } else {
      WeatherAbsent(everReceived: everReceived)
    }
  }

  private func content(_ forecast: WatchWeather) -> some View {
    VStack(spacing: 0) {
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        WeatherGlyph(slug: forecast.icon, size: HERO_ICON_SIZE, color: nil)
          .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 3 }
        Text("\(forecast.temperatureC)°")
          .font(.system(size: HERO_FONT_SIZE, weight: .semibold, design: .rounded))
          .foregroundStyle(Palette.primaryText)
          .monospacedDigit()
      }
      Text(forecast.label.uppercased())
        .font(.system(size: 10))
        .tracking(1.2)
        .foregroundStyle(Palette.secondaryText)
        .multilineTextAlignment(.center)
        .lineLimit(2)
        .minimumScaleFactor(0.8)
      if forecast.precipitationProbability > 0 {
        // All blue, glyph and number alike: rain is one reading, not an icon with a label.
        HStack(spacing: 4) {
          Image(systemName: rainSymbol)
            .font(.system(size: 9))
          Text("\(forecast.precipitationProbability)% rain")
            .font(.system(size: 12))
            .monospacedDigit()
        }
        .foregroundStyle(Palette.weather("cloud-rain"))
        .padding(.top, 2)
      }

      Spacer(minLength: 8)
      FadingRule()
        .padding(.horizontal, Rim.innerInset + 10)
      Spacer(minLength: 8)

      if forecast.hourly.isEmpty {
        // Current conditions without an hourly array: a phone that got a partial provider response.
        // The page still has something true to say, so it says only that.
        Text("Hours unavailable")
          .font(.system(size: 10))
          .foregroundStyle(Palette.dimText)
      } else {
        hours(forecast.hourly)
      }

      // Only the sun event still ahead: both at once needed a divider and ran the full width, and
      // the one already behind the rider is not what they are planning around.
      if let next = watchNextSunEvent(
        nowMinuteOfDay: nowMinuteOfDay,
        sunriseMinuteOfDay: forecast.sunriseMinuteOfDay,
        sunsetMinuteOfDay: forecast.sunsetMinuteOfDay
      ) {
        Spacer(minLength: 8)
        SunTime(event: next)
      }
      Spacer(minLength: 0)
    }
    .padding(.top, PAGE_TOP_INSET)
    .padding(.bottom, Rim.innerInset + 6)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  /// The strip scrolls out to the bezel rather than stopping short of it, so the inset is content
  /// padding on the scroll view and not a margin around it.
  private func hours(_ hourly: [WatchWeatherHour]) -> some View {
    ScrollView(.horizontal) {
      HStack(alignment: .top, spacing: HOUR_GAP) {
        ForEach(hourly, id: \.minuteOfDay) { hour in
          VStack(spacing: 2) {
            Text(watchFormatHour(hour.minuteOfDay))
              .font(.system(size: 9))
              .foregroundStyle(Palette.dimText)
              .monospacedDigit()
            WeatherGlyph(slug: hour.icon, size: HOUR_ICON_SIZE, color: nil)
            Text("\(hour.temperatureC)°")
              .font(.system(size: 12))
              .foregroundStyle(Palette.secondaryText)
              .monospacedDigit()
            // Reserved whether or not it is filled, so the strip does not step up and down as the
            // rider scrolls past a dry hour.
            Text(hour.precipitationProbability > 0 ? "\(hour.precipitationProbability)%" : " ")
              .font(.system(size: 9))
              .foregroundStyle(Palette.weather("cloud-rain"))
              .monospacedDigit()
          }
        }
      }
      .padding(.horizontal, Rim.innerInset + 4)
    }
    .scrollIndicators(.hidden)
  }

  /// The wall clock, read once per body evaluation. The page is inside the mirror's timeline, which
  /// re-evaluates on the active or ambient beat, so the sun event crosses on its own without a
  /// second timer of its own.
  private var nowMinuteOfDay: Int {
    watchMinuteOfDay(epochMs: Int64(Date().timeIntervalSince1970 * 1000))
  }
}

/// Why the page has no numbers on it. Distinguishing "never arrived" from "aged out" is the whole
/// value here: the first is a phone that has not got a fix yet, the second is a phone that stopped
/// refreshing, and only one of them is something the rider can do anything about.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WeatherScreen.kt `WeatherScreen`
private struct WeatherAbsent: View {
  let everReceived: Bool

  var body: some View {
    VStack(spacing: 4) {
      Text(everReceived ? "Forecast too old" : "No forecast")
        .font(.system(size: 15, weight: .semibold))
        .foregroundStyle(Palette.secondaryText)
      Text(everReceived ? "Phone stopped updating" : "Waiting for your phone")
        .font(.system(size: 11))
        .foregroundStyle(Palette.dimText)
    }
    .multilineTextAlignment(.center)
    .padding(.horizontal, Rim.innerInset + 6)
  }
}

/// Sunrise or sunset, mirroring the phone's expanded weather pill: a sun glyph with a caret for the
/// direction, amber going up and violet going down.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WeatherScreen.kt `SunTime`
/// @parity /src/modules/weather/components/WeatherPillView.tsx `sunTimes`
private struct SunTime: View {
  let event: WatchSunEvent

  var body: some View {
    let tint = Palette.weather(event.rising ? "sun" : "moon")
    HStack(spacing: 2) {
      Image(systemName: "sun.max")
        .font(.system(size: 10))
        .foregroundStyle(tint)
      Image(systemName: event.rising ? "chevron.up" : "chevron.down")
        .font(.system(size: 7, weight: .bold))
        .foregroundStyle(tint)
      Text(watchFormatHour(event.minuteOfDay))
        .font(.system(size: 10))
        .foregroundStyle(Palette.secondaryText)
        .monospacedDigit()
        .padding(.leading, 2)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(event.rising ? "Sunrise" : "Sunset")
    .accessibilityValue(watchFormatHour(event.minuteOfDay))
  }
}

/// A 1 pt rule that fades to nothing at both ends, so it never butts into the rounded corners.
///
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WeatherScreen.kt `FadingRule`
struct FadingRule: View {
  var body: some View {
    LinearGradient(
      colors: [.clear, Palette.guide, Palette.guide, .clear],
      startPoint: .leading,
      endPoint: .trailing
    )
    .frame(height: 1)
  }
}

/// Clear of the system clock, which watchOS draws over every app.
private let PAGE_TOP_INSET: CGFloat = 26
private let HERO_ICON_SIZE: CGFloat = 22
private let HERO_FONT_SIZE: CGFloat = 34
private let HOUR_ICON_SIZE: CGFloat = 15
private let HOUR_GAP: CGFloat = 10
