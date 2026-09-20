import { ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CheckIcon, PaletteIcon } from 'phosphor-react-native'

import { IconHero } from '@/components/settings/IconHero'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
import { theme } from '@/constants/theme'
import { THEME_OPTIONS } from '@/modules/settings/lib/themeOptions'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

function SelectionIndicator({ selected }: { selected: boolean }) {
  return (
    <View style={[styles.selection, selected && styles.selectionSelected]}>
      {selected ? <CheckIcon size={17} color={theme.palette.cyan.color} weight="bold" /> : null}
    </View>
  )
}

export function VisualsSettingsScreen() {
  const mode = useSettingsStore((state) => state.themeMode)
  const setSetting = useSettingsStore((state) => state.set)

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={PaletteIcon}
          description="Choose how Vescape balances daylight visibility and night comfort."
        />

        <SettingsSectionTitle>Theme</SettingsSectionTitle>
        <SettingsCard>
          {THEME_OPTIONS.map((option) => (
            <SettingsRow
              key={option.mode}
              icon={option.Icon}
              iconColor={option.hue.color}
              label={option.label}
              hint={option.hint}
              right={<SelectionIndicator selected={mode === option.mode} />}
              onPress={() => {
                void setSetting('themeMode', option.mode)
              }}
            />
          ))}
        </SettingsCard>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.neutral.bg,
  },
  content: {
    padding: 16,
    gap: 8,
  },
  selection: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: theme.neutral.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionSelected: {
    borderColor: theme.palette.cyan.color,
  },
})
