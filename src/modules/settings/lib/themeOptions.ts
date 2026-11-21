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

export const THEME_OPTIONS: {
  mode: ThemeMode
  label: string
  Icon: Icon
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
