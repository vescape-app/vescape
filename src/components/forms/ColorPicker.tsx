import { Pressable, StyleSheet, View } from 'react-native'
import { CheckIcon } from 'phosphor-react-native'

import { interaction, theme } from '@/constants/theme'

interface ColorPickerProps {
  /** Currently selected color (hex), or null when none is chosen. */
  value: string | null
  /** Selectable swatches. */
  colors: readonly string[]
  onChange: (color: string | null) => void
  /** Swatch diameter. */
  size?: number
}

/** A wrap of color swatches; the selected one shows a ring + check. Presentational. */
export function ColorPicker({ value, colors, onChange, size = 34 }: ColorPickerProps) {
  return (
    <View style={styles.grid}>
      {colors.map((color) => {
        const selected = value === color
        const dim = size - 8
        return (
          <Pressable
            key={color}
            onPress={() => onChange(selected ? null : color)}
            accessibilityLabel={`Color ${color}`}
            accessibilityState={{ selected }}
            android_ripple={interaction.rippleBorderless}
            style={({ pressed }) => [
              styles.ring,
              { width: size, height: size, borderRadius: size / 2 },
              selected && styles.ringSelected,
              pressed && { opacity: interaction.pressedOpacity },
            ]}
          >
            <View
              style={[
                styles.swatch,
                { width: dim, height: dim, borderRadius: dim / 2, backgroundColor: color },
              ]}
            >
              {selected ? (
                <CheckIcon size={dim * 0.55} color={theme.palette.mono.white} weight="bold" />
              ) : null}
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  ringSelected: {
    borderColor: theme.palette.slate.textPrimary,
  },
  swatch: {
    alignItems: 'center',
    justifyContent: 'center',
  },
})
