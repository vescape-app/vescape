import {
  CloudFogIcon,
  CloudIcon,
  CloudLightningIcon,
  CloudMoonIcon,
  CloudRainIcon,
  CloudSnowIcon,
  CloudSunIcon,
  MoonStarsIcon,
  SunIcon,
  type Icon,
} from 'phosphor-react-native'
import type { WeatherIconSlug } from 'vescape-core'

import { theme, type ThemeColor } from '@/constants/theme'

const ICON_MAP: Record<WeatherIconSlug, Icon> = {
  sun: SunIcon,
  moon: MoonStarsIcon,
  'cloud-sun': CloudSunIcon,
  'cloud-moon': CloudMoonIcon,
  cloud: CloudIcon,
  'cloud-fog': CloudFogIcon,
  'cloud-rain': CloudRainIcon,
  'cloud-snow': CloudSnowIcon,
  'cloud-lightning': CloudLightningIcon,
}

interface WeatherIconProps {
  icon: WeatherIconSlug
  size?: number
  color?: ThemeColor
  weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone'
}

/** The Phosphor icon for a condition slug, for surfaces that take an icon component. */
export function weatherIconComponent(icon: WeatherIconSlug): Icon {
  return ICON_MAP[icon] ?? CloudIcon
}

/** The pictogram for a condition slug. Native decided which slug; this only draws it. */
export function WeatherIcon({
  icon,
  size = 20,
  color = theme.neutral.textSecondary,
  weight = 'duotone',
}: WeatherIconProps) {
  const IconComponent = weatherIconComponent(icon)
  return <IconComponent size={size} color={color} weight={weight} />
}
