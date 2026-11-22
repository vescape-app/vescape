import { theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'

export const widgetSurface = {
  backgroundColor: theme.control.background,
  borderColor: theme.control.border,
  borderWidth: 1,
  borderRadius: 18,
} as const

const secondaryWidgetSurface = {
  backgroundColor: theme.neutral.surfaceDeep,
  borderColor: theme.neutral.border,
  borderWidth: 1,
  borderRadius: 18,
} as const

export function useResolvedSecondaryWidgetSurface() {
  const neutral = useResolvedNeutralColors()
  return {
    ...secondaryWidgetSurface,
    backgroundColor: neutral.surfaceDeep,
    borderColor: neutral.border,
  }
}

export function useResolvedSecondaryWidgetPressed() {
  const neutral = useResolvedNeutralColors()
  return { backgroundColor: neutral.surface }
}

export const presentationWidgetSurface = {
  backgroundColor: theme.alpha(theme.palette.mono.black, 0),
  borderColor: theme.alpha(theme.palette.mono.black, 0),
  borderWidth: 0,
  borderRadius: 0,
} as const

export type WidgetSize = 'square' | 'half' | 'full'
