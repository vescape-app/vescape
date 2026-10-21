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
  /** Tint of the selected state. */
  accent?: ThemeColor
  /** `sm` sits beside a list row's label; `lg` anchors the trailing edge of a card. */
  size?: keyof typeof SIZES
}

/**
 * The circle that marks one choice among several. Decorative — the row around it is the pressable
 * and carries the accessibility state. Shares the switch's colored-action surface, so a selection
 * control reads the same whether it toggles or picks.
 */
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
