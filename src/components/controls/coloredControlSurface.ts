import { neutralColors, theme, type ThemeColor } from '@/constants/theme'
import {
  useColoredAction,
  useColoredActionForeground,
  useResolvedControlColors,
  useThemeStore,
} from '@/hooks/useTheme'

/**
 * Selection controls (switch, radio) draw on a dark surface in both appearances — the card itself
 * on dark, a navy control base on light — so their greys are the dark-theme neutrals.
 */
export const CONTROL_INK = neutralColors.dark

/**
 * The colored-action surface a selection control sits on, resolved to plain strings so worklets
 * can interpolate them. On light the base is navy with the accent washed over it when selected; on
 * dark the accent alone tints the card beneath. The accent keeps its dark-theme tone either way.
 */
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
