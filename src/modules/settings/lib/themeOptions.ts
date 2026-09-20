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

/** The four theme choices, shared by the Appearance screen and the Settings Drawer row. */
export const THEME_OPTIONS: {
  mode: ThemeMode
  label: string
  hint: string
  Icon: Icon
  /** Palette hue for icon, pill, and active-option tinting. */
  hue: ThemeHue
}[] = [
  {
    mode: 'system',
    label: 'System',
    hint: 'Follow the phone appearance setting',
    Icon: DesktopIcon,
    hue: theme.palette.sky,
  },
  {
    mode: 'light',
    label: 'Light',
    hint: 'Keep the app bright',
    Icon: SunIcon,
    hue: theme.palette.amber,
  },
  {
    mode: 'dark',
    label: 'Dark',
    hint: 'Keep the app dim',
    Icon: MoonStarsIcon,
    hue: theme.palette.violet,
  },
  {
    mode: 'sun',
    label: 'Sunrise & sunset',
    hint: 'Use daylight at the current or last known location',
    Icon: SunHorizonIcon,
    hue: theme.palette.orange,
  },
]
