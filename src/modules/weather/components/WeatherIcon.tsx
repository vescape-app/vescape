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

import { theme } from '@/constants/theme'

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
  color?: string
  weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone'
}

/** The pictogram for a condition slug. Native decided which slug; this only draws it. */
export function WeatherIcon({
  icon,
  size = 20,
  color = theme.neutral.textSecondary,
  weight = 'duotone',
}: WeatherIconProps) {
  const IconComponent = ICON_MAP[icon] ?? CloudIcon
  return <IconComponent size={size} color={color} weight={weight} />
}
