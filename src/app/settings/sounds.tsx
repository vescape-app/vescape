import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CheckIcon, PlusIcon, SpeakerHighIcon, VibrateIcon } from 'phosphor-react-native'
import { playAppSound } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
import { SettingsSwitch } from '@/components/settings/SettingsSwitch'
import { interaction, theme } from '@/constants/theme'
import { APP_SOUND_CUES } from '@/modules/settings/lib/appSounds'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

const PACKS = [
  { id: 'retro', name: 'Retro' },
  { id: 'simple', name: 'Classic' },
] as const

export default function SoundsSettingsScreen() {
  const soundPack = useSettingsStore((state) => state.soundPack)
  const enabled = useSettingsStore((state) => state.connectionSoundsEnabled)
  const set = useSettingsStore((state) => state.set)

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <SettingsSectionTitle>Playback</SettingsSectionTitle>
        <SettingsCard>
          <SettingsRow
            icon={VibrateIcon}
            iconColor={theme.palette.cyan.color}
            label="App sounds"
            right={
              <SettingsSwitch
                value={enabled}
                onValueChange={(value) => void set('connectionSoundsEnabled', value)}
              />
            }
          />
        </SettingsCard>

        <SettingsSectionTitle>Sound packs</SettingsSectionTitle>
        <View
          style={[styles.packList, !enabled && styles.disabledPacks]}
          pointerEvents={enabled ? 'auto' : 'none'}
        >
          {PACKS.map((pack) => {
            const active = soundPack === pack.id
            return (
              <View key={pack.id} style={[styles.pack, active && styles.activePack]}>
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active, disabled: !enabled }}
                  accessibilityLabel={pack.name}
                  onPress={() => void set('soundPack', pack.id)}
                  style={({ pressed }) => [styles.packHeader, pressed && styles.pressed]}
                >
                  <View style={styles.packIcon}>
                    <SpeakerHighIcon
                      size={19}
                      color={active ? theme.palette.cyan.color : theme.neutral.textMuted}
                      weight="duotone"
                    />
                  </View>
                  <Text style={[styles.packName, active && styles.activePackName]}>
                    {pack.name}
                  </Text>
                  <View style={[styles.selection, active && styles.selectionSelected]}>
                    {active && (
                      <CheckIcon size={17} color={theme.palette.cyan.color} weight="bold" />
                    )}
                  </View>
                </Pressable>
                {active && (
                  <View style={styles.previewStrip}>
                    {[APP_SOUND_CUES.slice(0, 3), APP_SOUND_CUES.slice(3)].map((row, rowIndex) => (
                      <View
                        key={rowIndex}
                        style={[styles.previewRow, rowIndex > 0 && styles.previewRowDivider]}
                      >
                        {row.map((cue, index) => (
                          <Pressable
                            key={cue.id}
                            accessibilityRole="button"
                            accessibilityLabel={`Play ${cue.label}`}
                            onPress={() => playAppSound(pack.id, cue.id)}
                            style={({ pressed }) => [
                              styles.preview,
                              index > 0 && styles.previewDivider,
                              pressed && styles.pressed,
                            ]}
                          >
                            <SpeakerHighIcon
                              size={18}
                              color={theme.palette.cyan.color}
                              weight="duotone"
                            />
                            <Text style={styles.previewLabel}>{cue.label}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )
          })}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add sound pack"
            accessibilityState={{ disabled: !enabled }}
            onPress={() =>
              Alert.alert('Custom sounds', 'Adding your own sound packs is coming later.')
            }
            style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}
          >
            <View style={styles.addIcon}>
              <PlusIcon size={19} color={theme.palette.cyan.color} weight="bold" />
            </View>
            <Text style={styles.addText}>Add sound pack</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 16, gap: 10, paddingBottom: 32 },
  packList: { gap: 10 },
  disabledPacks: { opacity: 0.5 },
  pack: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    backgroundColor: theme.neutral.surfaceDeep,
    overflow: 'hidden',
  },
  activePack: { borderColor: theme.palette.cyan.color },
  packHeader: {
    minHeight: 68,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  packIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: theme.neutral.surface,
    alignItems: 'center',
    justifyContent: 'center',
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
  selectionSelected: { borderColor: theme.palette.cyan.color },
  packName: { flex: 1, fontSize: 16, color: theme.neutral.textSecondary, fontWeight: '600' },
  activePackName: { color: theme.neutral.textPrimary, fontWeight: '700' },
  previewStrip: { borderTopWidth: 1, borderTopColor: theme.neutral.border },
  previewRow: { flexDirection: 'row' },
  previewRowDivider: { borderTopWidth: 1, borderTopColor: theme.neutral.border },
  preview: {
    flex: 1,
    minHeight: 68,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 4,
  },
  previewDivider: { borderLeftWidth: 1, borderLeftColor: theme.neutral.border },
  previewLabel: { fontSize: 11, color: theme.neutral.textMuted, textAlign: 'center' },
  addRow: {
    minHeight: 56,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  addIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addText: { color: theme.palette.cyan.color, fontSize: 15, fontWeight: '600' },
  pressed: { backgroundColor: interaction.pressedBg },
})
