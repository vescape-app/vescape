import SwiftUI

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WeatherScreen.kt `WeatherScreen`
struct WeatherScreen: View {
  let forecast: WatchWeather?
  var everReceived: Bool = false
  var timeFormat: String = "24h"

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
        DegreeNumber(
          value: "\(forecast.temperatureC)",
          size: HERO_FONT_SIZE,
          color: Palette.primaryText
        )
      }
      Text(forecast.label.uppercased())
        .font(WatchTypography.ui(size: 10))
        .tracking(1.2)
        .foregroundStyle(Palette.secondaryText)
        .multilineTextAlignment(.center)
        .lineLimit(2)
        .minimumScaleFactor(0.8)
      if forecast.precipitationProbability > 0 {
        HStack(spacing: 4) {
          PhosphorGlyph(rainIcon, size: 9, color: Palette.weather("cloud-rain"))
          Text("\(forecast.precipitationProbability)% rain")
            .font(WatchTypography.mono(size: 12))
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
        Text("Hours unavailable")
          .font(WatchTypography.ui(size: 10))
          .foregroundStyle(Palette.dimText)
      } else {
        hours(forecast.hourly)
      }

      if let next = watchNextSunEvent(
        nowMinuteOfDay: nowMinuteOfDay,
        sunriseMinuteOfDay: forecast.sunriseMinuteOfDay,
        sunsetMinuteOfDay: forecast.sunsetMinuteOfDay
      ) {
        Spacer(minLength: 8)
        SunTime(timeFormat: timeFormat, event: next)
      }
      Spacer(minLength: 0)
    }
    .padding(.top, PAGE_TOP_INSET)
    .padding(.bottom, Rim.innerInset + 6)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  private func hours(_ hourly: [WatchWeatherHour]) -> some View {
    ScrollView(.horizontal) {
      HStack(alignment: .top, spacing: HOUR_GAP) {
        ForEach(hourly, id: \.minuteOfDay) { hour in
          VStack(spacing: 2) {
            Text(watchFormatHour(hour.minuteOfDay, timeFormat: timeFormat))
              .font(WatchTypography.mono(size: 9))
              .foregroundStyle(Palette.dimText)
              .monospacedDigit()
            WeatherGlyph(slug: hour.icon, size: HOUR_ICON_SIZE, color: nil)
            DegreeNumber(
              value: "\(hour.temperatureC)",
              size: 12,
              color: Palette.secondaryText
            )
            Text(hour.precipitationProbability > 0 ? "\(hour.precipitationProbability)%" : " ")
              .font(WatchTypography.mono(size: 9))
              .foregroundStyle(Palette.weather("cloud-rain"))
              .monospacedDigit()
          }
        }
      }
      .padding(.horizontal, Rim.innerInset + 4)
    }
    .scrollIndicators(.hidden)
  }

  private var nowMinuteOfDay: Int {
    watchMinuteOfDay(epochMs: Int64(Date().timeIntervalSince1970 * 1000))
  }
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WeatherScreen.kt `WeatherScreen`
private struct WeatherAbsent: View {
  let everReceived: Bool

  var body: some View {
    VStack(spacing: 4) {
      Text(everReceived ? "Forecast too old" : "No forecast")
        .font(WatchTypography.ui(size: 15, weight: .semibold))
        .foregroundStyle(Palette.secondaryText)
      Text(everReceived ? "Phone stopped updating" : "Waiting for your phone")
        .font(WatchTypography.ui(size: 11))
        .foregroundStyle(Palette.dimText)
    }
    .multilineTextAlignment(.center)
    .padding(.horizontal, Rim.innerInset + 6)
  }
}

/// @parity /watch/wearos/src/main/java/app/vescape/wear/WeatherScreen.kt `SunTime`
/// @parity /src/modules/weather/components/WeatherPillView.tsx `sunTimes`
private struct SunTime: View {
  var timeFormat: String = "24h"
  let event: WatchSunEvent

  var body: some View {
    let tint = Palette.weather(event.rising ? "sun" : "moon")
    HStack(spacing: 2) {
      PhosphorGlyph(.sun, size: 10, color: tint)
      PhosphorGlyph(event.rising ? .caretUp : .caretDown, size: 7, color: tint)
      Text(watchFormatHour(event.minuteOfDay, timeFormat: timeFormat))
        .font(WatchTypography.mono(size: 10))
        .foregroundStyle(Palette.secondaryText)
        .monospacedDigit()
        .padding(.leading, 2)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(event.rising ? "Sunrise" : "Sunset")
    .accessibilityValue(watchFormatHour(event.minuteOfDay, timeFormat: timeFormat))
  }
}

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

private let PAGE_TOP_INSET: CGFloat = 26
private let HERO_ICON_SIZE: CGFloat = 22
private let HERO_FONT_SIZE: CGFloat = 34
private let HOUR_ICON_SIZE: CGFloat = 15
private let HOUR_GAP: CGFloat = 10
