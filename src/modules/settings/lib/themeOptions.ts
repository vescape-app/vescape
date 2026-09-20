import {
  DesktopIcon,
  MoonStarsIcon,
  SunHorizonIcon,
  SunIcon,
  type Icon,
} from 'phosphor-react-native'

import { theme } from '@/constants/theme'
import type { ThemeMode } from '@/modules/settings/lib/themeMode'

/** The four theme choices, shared by the Appearance screen and the Settings Drawer row. */
export const THEME_OPTIONS: {
  mode: ThemeMode
  label: string
  hint: string
  Icon: Icon
  color: string
}[] = [
  {
    mode: 'system',
    label: 'System',
    hint: 'Follow the phone appearance setting',
    Icon: DesktopIcon,
    color: theme.palette.sky.color,
  },
  {
    mode: 'light',
    label: 'Light',
    hint: 'Keep the app bright',
    Icon: SunIcon,
    color: theme.palette.amber.color,
  },
  {
    mode: 'dark',
    label: 'Dark',
    hint: 'Keep the app dim',
    Icon: MoonStarsIcon,
    color: theme.palette.violet.color,
  },
  {
    mode: 'sun',
    label: 'Sunrise & sunset',
    hint: 'Use daylight at the current or last known location',
    Icon: SunHorizonIcon,
    color: theme.palette.orange.color,
  },
]
