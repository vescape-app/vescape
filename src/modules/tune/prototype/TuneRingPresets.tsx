import { ScrollView, StyleSheet, View } from 'react-native'
import { TreeIcon, CityIcon, MagicWandIcon, CoffeeIcon, CompassIcon } from 'phosphor-react-native'
import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { TUNE_PRESETS } from './tuneRingControls'
const PRESET_ICONS = [TreeIcon, CityIcon, MagicWandIcon, CoffeeIcon, CompassIcon]
export function TuneRingPresets({
  activePreset,
  color,
  onApply,
}: {
  activePreset: string | null
  color: string
  onApply: (preset: (typeof TUNE_PRESETS)[number]) => void
}) {
  const neutral = useResolvedNeutralColors()
  return (
    <View style={{ gap: 4 }}>
      <Text
        accessibilityRole="header"
        style={{ fontSize: 12, fontWeight: '700', color: neutral.textMuted }}
      >
        Start with a preset
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.presets}
      >
        {TUNE_PRESETS.map((preset, index) => (
          <Button
            key={preset.name}
            label={preset.name}
            icon={PRESET_ICONS[index]}
            size="sm"
            variant="secondary"
            accent={activePreset === preset.name ? color : undefined}
            style={styles.presetBadge}
            accessibilityLabel={`${preset.name}, demo preset${activePreset === preset.name ? ', selected' : ''}`}
            onPress={() => onApply(preset)}
          />
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  presets: { gap: 8, alignItems: 'center', paddingVertical: 4 },
  presetBadge: { borderRadius: 999 },
})
