import { isSharedValue, useDerivedValue, type SharedValue } from 'react-native-reanimated'

import { MonoValue, type MonoValueProps } from '@/components/base/MonoValue'
import { theme } from '@/constants/theme'
import { useResolvedColor } from '@/hooks/useTheme'
import { DASH } from '@/helpers/format'

interface TickTextProps extends Omit<MonoValueProps, 'text'> {
  /** Live value driven off the UI thread; updates without re-rendering React. */
  value: SharedValue<number | null>
  decimals: number
  unit?: string
  /** Color of the placeholder shown while there is no value. */
  emptyColor?: string
}

/**
 * Renders a live numeric value from a Reanimated SharedValue at the tick rate (~31Hz) without
 * triggering React re-renders. Formatting runs on the UI thread, so only `decimals`/`unit`
 * (worklet-serializable primitives) are supported — keep it to plain numbers.
 *
 * With no value the readout falls back to the bare unit, dimmed: a row of identical dashes says
 * nothing, while a dim "°C" next to a dim "A" still tells the rider which cell is which.
 */
export function TickText({
  value,
  decimals,
  unit,
  emptyColor = theme.palette.slate.textDim,
  color = theme.palette.slate.textPrimary,
  ...monoProps
}: TickTextProps) {
  const emptyText = unit?.trim() || DASH

  const text = useDerivedValue(() => {
    const v = value.value
    if (v == null || !Number.isFinite(v)) return emptyText
    const n = decimals === 0 ? Math.round(v).toString() : v.toFixed(decimals)
    // No separator: the monospace font renders any space at full cell width, so the unit is
    // appended directly to the number.
    return unit ? `${n}${unit}` : n
  })

  // Adaptive tokens are native color objects; resolve them here so the worklet only ever hands
  // Skia a plain color string.
  const animatedColor = isSharedValue<string>(color) ? color : null
  const staticColor = useResolvedColor(
    isSharedValue<string>(color) ? theme.palette.slate.textPrimary : (color as string),
  )
  const resolvedEmptyColor = useResolvedColor(emptyColor)
  const tickColor = useDerivedValue(() => {
    const v = value.value
    if (v == null || !Number.isFinite(v)) return resolvedEmptyColor
    return animatedColor ? animatedColor.value : staticColor
  })

  return <MonoValue text={text} color={tickColor} {...monoProps} />
}
