import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import * as DocumentPicker from 'expo-document-picker'
import { Alert, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  CheckIcon,
  PlusIcon,
  SpeakerHighIcon,
  SpeakerSimpleHighIcon,
  VibrateIcon,
} from 'phosphor-react-native'
import {
  createAppSoundPack,
  customAppSoundPacks,
  deleteAppSoundPack,
  importAppSound,
  playAppSound,
  removeAppSound,
  renameAppSoundPack,
  type CustomAppSoundPack,
} from 'vescape-core'

import { Text } from '@/components/base/Text'
import { Button } from '@/components/base/Button'
import { IconButton } from '@/components/base/IconButton'
import { ConfirmModal } from '@/components/modals/ConfirmModal'
import { Select } from '@/components/forms/Select'
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
  const audioSource = useSettingsStore((state) => state.audioSource)
  const enabled = useSettingsStore((state) => state.connectionSoundsEnabled)
  const set = useSettingsStore((state) => state.set)
  const [customPacks, setCustomPacks] = useState<CustomAppSoundPack[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [packLoadError, setPackLoadError] = useState(false)
  useFocusEffect(
    useCallback(() => {
      void customAppSoundPacks()
        .then((packs) => {
          setCustomPacks(packs)
          setPackLoadError(false)
        })
        .catch(() => setPackLoadError(true))
    }, []),
  )
  const refresh = async () => setCustomPacks(await customAppSoundPacks())
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await action()
      await refresh()
    } catch (error) {
      Alert.alert(
        'Sound pack',
        error instanceof Error ? error.message : 'Could not save sound pack',
      )
    } finally {
      setBusy(false)
    }
  }
  const pick = (id: string, cue: (typeof APP_SOUND_CUES)[number]['id']) => {
    void run(async () => {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['audio/wav', 'audio/x-wav'],
        copyToCacheDirectory: true,
      })
      if (result.canceled) return
      const uri = result.assets[0]?.uri
      if (!uri) throw new Error('No audio file selected')
      await importAppSound(id, cue, uri)
    })
  }
  const packs: { id: string; name: string; sounds?: CustomAppSoundPack['sounds'] }[] = [
    ...PACKS,
    ...customPacks,
  ]

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
          {Platform.OS === 'android' && (
            <SettingsRow
              icon={SpeakerSimpleHighIcon}
              iconColor={theme.palette.cyan.color}
              label="Audio output"
              right={
                <Select
                  options={[
                    { label: 'Alarm', value: 'alarm' },
                    { label: 'Media', value: 'media' },
                  ]}
                  value={audioSource}
                  onChange={(source) => void set('audioSource', source)}
                  style={styles.sourceSelect}
                  testID="audio-output-select"
                />
              }
            >
              <Text style={styles.sourceDescription}>
                Alarm is recommended. Make sure alarm volume isn't muted. If it causes problems,
                choose Media, which uses media volume.
              </Text>
            </SettingsRow>
          )}
        </SettingsCard>

        <SettingsSectionTitle>Sound packs</SettingsSectionTitle>
        {packLoadError && (
          <Text>Sound packs could not be loaded. Try opening this screen again.</Text>
        )}
        <View
          style={[styles.packList, !enabled && styles.disabledPacks]}
          pointerEvents={enabled ? 'auto' : 'none'}
        >
          {packs.map((pack) => {
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
                {pack.sounds && (
                  <View style={styles.editor}>
                    {editingId === pack.id ? (
                      <View style={styles.nameRow}>
                        <TextInput
                          value={name}
                          onChangeText={setName}
                          maxLength={60}
                          placeholder="Pack name"
                          placeholderTextColor={theme.neutral.textMuted}
                          style={styles.nameInput}
                        />
                        <Button
                          label="Save"
                          size="sm"
                          disabled={busy || !name.trim()}
                          onPress={() =>
                            void run(async () => {
                              await renameAppSoundPack(pack.id, name)
                              setEditingId(null)
                            })
                          }
                        />
                      </View>
                    ) : (
                      <Button
                        label="Rename"
                        variant="secondary"
                        size="sm"
                        onPress={() => {
                          setName(pack.name)
                          setEditingId(pack.id)
                        }}
                      />
                    )}
                    {APP_SOUND_CUES.map((cue) => (
                      <View key={cue.id} style={styles.cueBlock}>
                        <View style={styles.cueRow}>
                          <Text style={styles.cueName}>{cue.label}</Text>
                          <Text style={styles.cueStatus}>
                            {pack.sounds?.[cue.id] ? 'Custom' : 'Classic'}
                          </Text>
                        </View>
                        <View style={styles.cueRow}>
                          <IconButton
                            icon={SpeakerHighIcon}
                            accessibilityLabel={`Play ${cue.label}`}
                            onPress={() => playAppSound(pack.id, cue.id)}
                          />
                          <Button
                            label={pack.sounds?.[cue.id] ? 'Replace' : 'Add'}
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onPress={() => pick(pack.id, cue.id)}
                          />
                          {pack.sounds?.[cue.id] && (
                            <Button
                              label="Remove"
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              onPress={() => void run(() => removeAppSound(pack.id, cue.id))}
                            />
                          )}
                        </View>
                      </View>
                    ))}
                    <Button
                      label="Delete pack"
                      size="sm"
                      variant="destructive"
                      onPress={() => setDeleteId(pack.id)}
                    />
                  </View>
                )}
              </View>
            )
          })}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add sound pack"
            accessibilityState={{ disabled: !enabled }}
            onPress={() => {
              setEditingId('new')
              setName('')
            }}
            style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}
          >
            <View style={styles.addIcon}>
              <PlusIcon size={19} color={theme.palette.cyan.color} weight="bold" />
            </View>
            <Text style={styles.addText}>Add sound pack</Text>
          </Pressable>
          {editingId === 'new' && (
            <View style={styles.editor}>
              <TextInput
                value={name}
                onChangeText={setName}
                maxLength={60}
                placeholder="Pack name"
                placeholderTextColor={theme.neutral.textMuted}
                style={styles.nameInput}
                autoFocus
              />
              <Button
                label="Create pack"
                disabled={busy || !name.trim()}
                onPress={() =>
                  void run(async () => {
                    await createAppSoundPack(name)
                    setEditingId(null)
                  })
                }
              />
            </View>
          )}
        </View>
      </ScrollView>
      <ConfirmModal
        visible={deleteId !== null}
        title="Delete sound pack"
        message="Delete this pack and its imported sounds?"
        confirmLabel="Delete"
        destructive
        onCancel={() => setDeleteId(null)}
        onConfirm={() => {
          const id = deleteId
          setDeleteId(null)
          if (id)
            void run(async () => {
              await deleteAppSoundPack(id)
              if (soundPack === id) await useSettingsStore.getState().load()
            })
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 16, gap: 10, paddingBottom: 32 },
  packList: { gap: 10 },
  sourceSelect: { width: 150 },
  sourceDescription: {
    color: theme.neutral.textMuted,
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 58,
    marginRight: 14,
    marginBottom: 14,
  },
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
  editor: { padding: 14, gap: 10, borderTopWidth: 1, borderTopColor: theme.neutral.border },
  nameRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  nameInput: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    color: theme.neutral.textPrimary,
  },
  cueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cueBlock: { gap: 6, paddingVertical: 6, borderTopWidth: 1, borderTopColor: theme.neutral.border },
  cueName: { flex: 1, color: theme.neutral.textPrimary, fontSize: 13 },
  cueStatus: { color: theme.neutral.textMuted, fontSize: 12 },
  pressed: { backgroundColor: interaction.pressedBg },
})
