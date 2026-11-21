import { StyleSheet, View } from 'react-native'
import { CheckIcon } from 'phosphor-react-native'

import { CONTROL_INK, useColoredControlSurface } from '@/components/controls/coloredControlSurface'
import { theme, type ThemeColor } from '@/constants/theme'

const SIZES = {
  sm: { box: 22, check: 14 },
  lg: { box: 40, check: 17 },
} as const

interface RadioIndicatorProps {
  selected: boolean
  accent?: ThemeColor
  size?: keyof typeof SIZES
}

export function RadioIndicator({
  selected,
  accent = theme.palette.sky.color,
  size = 'sm',
}: RadioIndicatorProps) {
  const surface = useColoredControlSurface(accent)
  const { box, check } = SIZES[size]

  return (
    <View
      style={[
        styles.circle,
        {
          width: box,
          height: box,
          borderRadius: box / 2,
          borderColor: selected ? surface.tint : CONTROL_INK.border,
          backgroundColor: selected ? surface.selected : surface.unselected,
        },
      ]}
    >
      {selected ? <CheckIcon size={check} color={surface.tint} weight="bold" /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  circle: {
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
