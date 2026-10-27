import {
  DesktopIcon,
  MoonStarsIcon,
  SunHorizonIcon,
  SunIcon,
  type Icon,
} from 'phosphor-react-native'

import { theme } from '@/constants/theme'
import type { ThemeMode } from '@/modules/settings/lib/themeMode'

type ThemeHue = (typeof theme.palette)['cyan']

/** The four theme choices used by the inline quick-settings picker. */
export const THEME_OPTIONS: {
  mode: ThemeMode
  label: string
  Icon: Icon
  /** Palette hue for icon, pill, and active-option tinting. */
  hue: ThemeHue
}[] = [
  {
    mode: 'system',
    label: 'System',
    Icon: DesktopIcon,
    hue: theme.palette.sky,
  },
  {
    mode: 'light',
    label: 'Light',
    Icon: SunIcon,
    hue: theme.palette.amber,
  },
  {
    mode: 'dark',
    label: 'Dark',
    Icon: MoonStarsIcon,
    hue: theme.palette.violet,
  },
  {
    mode: 'sun',
    label: 'Sunrise & sunset',
    Icon: SunHorizonIcon,
    hue: theme.palette.orange,
  },
]
