import { useDerivedValue, type SharedValue } from 'react-native-reanimated'

import { MonoValue } from '@/components/base/MonoValue'
import { theme } from '@/constants/theme'

const WIDTH = 110

const SIZE = 15

interface LiveNumberProps {
  value: SharedValue<number>
  decimals: number
  unit?: string
}

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
