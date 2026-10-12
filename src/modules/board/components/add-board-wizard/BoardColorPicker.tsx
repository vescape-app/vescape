import * as Haptics from 'expo-haptics'
import { Pressable, StyleSheet, View } from 'react-native'

import { personalizationColorOptions, theme } from '@/constants/theme'

const RAIL_COLORS = personalizationColorOptions
export type RailColorId = (typeof RAIL_COLORS)[number]['id']

export function BoardColorPicker({
  railColorId,
  onRailColorChange,
}: {
  railColorId: RailColorId
  onRailColorChange: (id: RailColorId) => void
}) {
  const selectedColor =
    RAIL_COLORS.find((color) => color.id === railColorId)?.value ?? RAIL_COLORS[0].value

  return (
    <View style={styles.colors} accessibilityRole="radiogroup">
      {RAIL_COLORS.map((color) => {
        const selected = color.id === railColorId
        const swatchStyle = { backgroundColor: color.value }
        return (
          <Pressable
            key={color.id}
            onPress={() => {
              onRailColorChange(color.id)
              void Haptics.selectionAsync()
            }}
            accessibilityRole="radio"
            accessibilityLabel={`${color.id} rails`}
            accessibilityState={{ selected }}
            style={({ pressed }) => [
              styles.colorTarget,
              selected && { borderColor: selectedColor },
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.colorSwatch, swatchStyle]} />
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  colors: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    maxWidth: 300,
    alignSelf: 'center',
  },
  colorTarget: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: theme.neutral.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorSwatch: { width: 22, height: 22, borderRadius: 11 },
  pressed: { opacity: 0.7 },
})
