import { neutralColors, theme, type ThemeColor } from '@/constants/theme'
import {
  useColoredAction,
  useColoredActionForeground,
  useResolvedControlColors,
  useThemeStore,
} from '@/hooks/useTheme'

export const CONTROL_INK = neutralColors.dark

export function useColoredControlSurface(accent: ThemeColor) {
  const onNavy = useThemeStore((state) => state.resolvedTheme) === 'light'
  const control = useResolvedControlColors()
  const tint = useColoredActionForeground(accent)
  return {
    onNavy,
    tint,
    tintSoft: theme.alpha(tint, 0.6),
    selected: useColoredAction(accent),
    unselected: onNavy ? control.background : theme.alpha(tint, 0),
  }
}
