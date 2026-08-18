import type { WeatherIconSlug } from 'vescape-core'

import { theme } from '@/constants/theme'

/**
 * Condition tint, keyed by the icon slug native resolves. Presentation only — native owns which WMO
 * code is which condition, this side owns what that condition looks like on the phone.
 *
 * @parity /watch/wearos/src/main/java/app/vescape/wear/Palette.kt `weatherColor`
 */
export function weatherIconColor(icon: WeatherIconSlug): string {
  switch (icon) {
    case 'sun':
      return theme.weather.sun
    case 'moon':
      return theme.weather.moon
    case 'cloud-sun':
      return theme.weather.partly
    case 'cloud-moon':
      return theme.weather.moonPartly
    case 'cloud-fog':
      return theme.weather.fog
    case 'cloud-rain':
      return theme.weather.rain
    case 'cloud-snow':
      return theme.weather.snow
    case 'cloud-lightning':
      return theme.weather.thunder
    case 'cloud':
      return theme.weather.cloud
  }
}

/**
 * `H:MM` for a minute-of-day. Native carries forecast times as minutes since **local midnight at the
 * forecast location**, so this formats a label and never touches the device timezone.
 *
 * @parity /watch/wearos/src/main/java/app/vescape/wear/WatchWeather.kt `formatHour`
 */
export function formatHour(minuteOfDay: number): string {
  const hour = Math.floor(minuteOfDay / 60) % 24
  const minute = minuteOfDay % 60
  return `${hour}:${String(minute).padStart(2, '0')}`
}
