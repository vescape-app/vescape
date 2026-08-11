import { useDerivedValue, type SharedValue } from 'react-native-reanimated'

import { MonoValue, type MonoValueProps } from '@/components/base/MonoValue'

interface TickTextProps extends Omit<MonoValueProps, 'text'> {
  /** Live value driven off the UI thread; updates without re-rendering React. */
  value: SharedValue<number | null>
  decimals: number
  unit?: string
}

/**
 * Renders a live numeric value from a Reanimated SharedValue at the tick rate (~31Hz) without
 * triggering React re-renders. Formatting runs on the UI thread, so only `decimals`/`unit`
 * (worklet-serializable primitives) are supported — keep it to plain numbers.
 */
export function TickText({ value, decimals, unit, ...monoProps }: TickTextProps) {
  const text = useDerivedValue(() => {
    const v = value.value
    if (v == null || !Number.isFinite(v)) return '-'
    const n = decimals === 0 ? Math.round(v).toString() : v.toFixed(decimals)
    // No separator: the monospace font renders any space at full cell width, so the unit is
    // appended directly to the number.
    return unit ? `${n}${unit}` : n
  })

  return <MonoValue text={text} {...monoProps} />
}
