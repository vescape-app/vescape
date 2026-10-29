import type { WeatherIconSlug } from 'vescape-core'

import { theme, type ThemeColor } from '@/constants/theme'

/**
 * Condition tint, keyed by the icon slug native resolves. Presentation only — native owns which WMO
 * code is which condition, this side owns what that condition looks like on the phone.
 *
 * @parity /watch/wearos/src/main/java/app/vescape/wear/Palette.kt `weatherColor`
 */
export function weatherIconColor(icon: WeatherIconSlug): ThemeColor {
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
