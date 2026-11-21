import { isSharedValue, useDerivedValue, type SharedValue } from 'react-native-reanimated'

import { MonoValue, type MonoValueProps } from '@/components/base/MonoValue'
import { theme, type ThemeColor } from '@/constants/theme'
import { useResolvedColor } from '@/hooks/useTheme'
import { DASH } from '@/helpers/format'

interface TickTextProps extends Omit<MonoValueProps, 'text'> {
  value: SharedValue<number | null>
  decimals: number
  unit?: string
  emptyColor?: ThemeColor
}

export function TickText({
  value,
  decimals,
  unit,
  emptyColor = theme.neutral.textDim,
  color = theme.neutral.textPrimary,
  ...monoProps
}: TickTextProps) {
  const emptyText = unit?.trim() || DASH

  const text = useDerivedValue(() => {
    const v = value.value
    if (v == null || !Number.isFinite(v)) return emptyText
    const n = decimals === 0 ? Math.round(v).toString() : v.toFixed(decimals)
    return unit ? `${n}${unit}` : n
  })

  const animatedColor = isSharedValue<string>(color) ? color : null
  const staticColor = useResolvedColor(
    isSharedValue<string>(color) ? theme.neutral.textPrimary : (color as ThemeColor),
  )
  const resolvedEmptyColor = useResolvedColor(emptyColor)
  const tickColor = useDerivedValue(() => {
    const v = value.value
    if (v == null || !Number.isFinite(v)) return resolvedEmptyColor
    return animatedColor ? animatedColor.value : staticColor
  })

  return <MonoValue text={text} color={tickColor} {...monoProps} />
}
