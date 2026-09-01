import { useDerivedValue, type SharedValue } from 'react-native-reanimated'

import { MonoValue } from '@/components/base/MonoValue'
import { theme } from '@/constants/theme'

/** Fits the widest readout on this screen without the row shifting as digits change. */
const WIDTH = 110

const SIZE = 15

interface LiveNumberProps {
  value: SharedValue<number>
  decimals: number
  unit?: string
}

/**
 * A number that changes as fast as the board sends it, without a React render.
 *
 * The board can push fifty frames a second, which is more than the reconciler should ever see for
 * five digits. `MonoValue` draws on Skia from a shared value, so a new reading is a repaint and
 * nothing else. `NaN` reads as `-`: a sensor that answered nothing has no number, and a stale one
 * would be a lie.
 */
export function LiveNumber({ value, decimals, unit }: LiveNumberProps) {
  const text = useDerivedValue(() => {
    const current = value.value
    if (Number.isNaN(current)) return '-'
    return unit ? `${current.toFixed(decimals)} ${unit}` : current.toFixed(decimals)
  })
  return (
    <MonoValue
      text={text}
      size={SIZE}
      weight="600"
      color={theme.neutral.textPrimary}
      align="right"
      width={WIDTH}
    />
  )
}
