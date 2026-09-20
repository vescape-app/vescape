import {
  ArrowDownIcon,
  ArrowUpIcon,
  HandPalmIcon,
  LightningIcon,
  MountainsIcon,
  NavigationArrowIcon,
  type Icon,
  WaveSineIcon,
} from 'phosphor-react-native'

import { theme, type ThemeColor } from '@/constants/theme'

const BASIC_SLIDER_ICONS: Record<string, Icon> = {
  aggressiveness: LightningIcon,
  noseStiffness: ArrowUpIcon,
  tailStiffness: ArrowDownIcon,
  carveTilt: WaveSineIcon,
  brakeTilt: HandPalmIcon,
  atrIntensity: MountainsIcon,
}

export function basicSliderIcon(sliderId: string): Icon {
  return BASIC_SLIDER_ICONS[sliderId] ?? NavigationArrowIcon
}

const BASIC_SLIDER_COLORS: Record<string, ThemeColor> = {
  aggressiveness: theme.telemetry.speed,
  noseStiffness: theme.telemetry.duty,
  tailStiffness: theme.telemetry.duty,
  carveTilt: theme.palette.pink.color,
  brakeTilt: theme.palette.orange.color,
  atrIntensity: theme.palette.green.color,
}

export function basicSliderColor(sliderId: string): ThemeColor {
  return BASIC_SLIDER_COLORS[sliderId] ?? theme.telemetry.speed
}
