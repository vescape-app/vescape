import { useState } from 'react'
import * as DocumentPicker from 'expo-document-picker'
import { Alert, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  ChatTextIcon,
  PencilSimpleIcon,
  PlusIcon,
  SpeakerHighIcon,
  SpeakerSimpleHighIcon,
  TrashSimpleIcon,
  VibrateIcon,
  WaveformIcon,
} from 'phosphor-react-native'
import {
  deleteMySound,
  importMySound,
  type MySoundsState,
  playPackSound,
  previewAlertSound,
  renameMySound,
  setSoundOverride,
} from 'vescape-core'

import { Text } from '@/components/base/Text'
import { Button } from '@/components/base/Button'
import { IconButton } from '@/components/base/IconButton'
import { ConfirmModal } from '@/components/modals/ConfirmModal'
import { Select } from '@/components/forms/Select'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
import { RadioIndicator } from '@/components/controls/RadioIndicator'
import { SegmentedToggle } from '@/components/controls/SegmentedToggle'
import { Switch } from '@/components/controls/Switch'
import { interaction, theme } from '@/constants/theme'
import {
  EFFECTS_PACKS,
  PACK_PREVIEW_ROWS,
  resolvedVoiceId,
  VOICE_LEVEL_INFO,
  SOUND_OVERRIDE_SLOTS,
  VOICE_LEVELS,
  VOICE_PACKS,
} from '@/modules/settings/lib/appSounds'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'
import { formatSlotAlertSound, mySoundRef } from '@/modules/alerts/lib/alertSoundString'
import { useMySounds } from '@/modules/alerts/hooks/useMySounds'

/** Picked file name without its extension, as a starting name for the sound. */
function soundName(fileName: string | undefined): string {
  return (
    (fileName ?? '')
      .replace(/\.(wav|m4a|mp3)$/i, '')
      .trim()
      .slice(0, 60) || 'My sound'
  )
}

/** One-shot preview of My sound `id`. */
const previewMySound = (id: string) => previewAlertSound(formatSlotAlertSound(1, mySoundRef(id)))

const PACK_OPTION = ''

export default function SoundsSettingsScreen() {
  const soundPack = useSettingsStore((state) => state.soundPack)
  const audioSource = useSettingsStore((state) => state.audioSource)
  const voice = useSettingsStore((state) => state.voice)
  const voiceLevel = useSettingsStore((state) => state.voiceLevel)
  const enabled = useSettingsStore((state) => state.connectionSoundsEnabled)
  const set = useSettingsStore((state) => state.set)
  const { state: library, setState: setLibrary, loadError } = useMySounds()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const run = async (action: () => Promise<MySoundsState | null>) => {
    setBusy(true)
    try {
      const next = await action()
      if (next) setLibrary(next)
    } catch (error) {
      Alert.alert('My sounds', error instanceof Error ? error.message : 'Could not save sound')
    } finally {
      setBusy(false)
    }
  }
  const addSound = () => {
    void run(async () => {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'audio/wav',
          'audio/x-wav',
          'audio/mp4',
          'audio/x-m4a',
          'audio/m4a',
          'audio/mpeg',
          'audio/mp3',
        ],
        copyToCacheDirectory: true,
      })
      if (result.canceled) return null
      const asset = result.assets[0]
      if (!asset?.uri) throw new Error('No audio file selected')
      return importMySound(asset.uri, soundName(asset.name))
    })
  }
  const commitName = (id: string, currentName: string) => {
    if (editingId !== id) return
    setEditingId(null)
    const trimmed = name.trim()
    if (!trimmed || trimmed === currentName) return
    void run(() => renameMySound(id, trimmed))
  }
  const overrideOptions = [
    { label: 'Pack', value: PACK_OPTION },
    ...library.sounds.map((sound) => ({ label: sound.name, value: sound.id })),
  ]

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <SettingsSectionTitle>Playback</SettingsSectionTitle>
        <SettingsCard>
          <SettingsRow
            icon={VibrateIcon}
            iconColor={theme.settingsIcon.sounds}
            label="App sounds"
            right={
              <Switch
                value={enabled}
                onValueChange={(value) => void set('connectionSoundsEnabled', value)}
              />
            }
          />
          {Platform.OS === 'android' && (
            <SettingsRow
              icon={SpeakerSimpleHighIcon}
              iconColor={theme.settingsIcon.sounds}
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

        <SettingsSectionTitle>Sound effects</SettingsSectionTitle>
        <View
          style={[styles.packList, !enabled && styles.disabledPacks]}
          pointerEvents={enabled ? 'auto' : 'none'}
        >
          {EFFECTS_PACKS.map((pack) => {
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
                      color={active ? theme.settingsIcon.sounds : theme.neutral.textMuted}
                      weight="duotone"
                    />
                  </View>
                  <Text style={[styles.packName, active && styles.activePackName]}>
                    {pack.name}
                  </Text>
                  <RadioIndicator selected={active} accent={theme.settingsIcon.sounds} size="lg" />
                </Pressable>
                {active && (
                  <View style={styles.previewStrip}>
                    {PACK_PREVIEW_ROWS.map((row, rowIndex) => (
                      <View
                        key={rowIndex}
                        style={[styles.previewRow, rowIndex > 0 && styles.previewRowDivider]}
                      >
                        {row.map((cue, index) => (
                          <Pressable
                            key={cue.label}
                            accessibilityRole="button"
                            accessibilityLabel={`Play ${cue.label}`}
                            onPress={() => playPackSound(pack.id, cue.slot)}
                            style={({ pressed }) => [
                              styles.preview,
                              index > 0 && styles.previewDivider,
                              pressed && styles.pressed,
                            ]}
                          >
                            <SpeakerHighIcon
                              size={18}
                              color={theme.settingsIcon.sounds}
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
        </View>

        <SettingsSectionTitle>Voice</SettingsSectionTitle>
        <SettingsCard>
          <SettingsRow
            icon={ChatTextIcon}
            iconColor={theme.settingsIcon.sounds}
            label="Voice"
            right={
              <Select
                options={VOICE_PACKS.map((pack) => ({ label: pack.name, value: pack.id }))}
                value={resolvedVoiceId(voice, soundPack)}
                onChange={(next) =>
                  // Preview once native has the new voice; a failed write shows in the storage banner.
                  void set('voice', next).then(
                    () => previewAlertSound(VOICE_LEVEL_INFO.standard.preview),
                    () => undefined,
                  )
                }
                style={styles.voiceSelect}
              />
            }
          />
          <SettingsRow
            icon={WaveformIcon}
            iconColor={theme.settingsIcon.sounds}
            label="Voice level"
          >
            <View style={styles.voiceLevel}>
              <SegmentedToggle
                options={[...VOICE_LEVELS]}
                value={voiceLevel}
                onChange={(next) =>
                  // The preview speaks with the new level's wording once native has it.
                  void set('voiceLevel', next).then(
                    () => previewAlertSound(VOICE_LEVEL_INFO[next].preview),
                    () => undefined,
                  )
                }
                accent={theme.settingsIcon.sounds}
              />
              <Text style={styles.voiceDescription}>
                {VOICE_LEVEL_INFO[voiceLevel].description}
              </Text>
            </View>
          </SettingsRow>
        </SettingsCard>

        <SettingsSectionTitle>My sounds</SettingsSectionTitle>
        {loadError && <Text>My sounds could not be loaded. Try opening this screen again.</Text>}
        <View style={styles.pack}>
          {library.sounds.map((sound) => {
            const editingName = editingId === sound.id
            return (
              <View key={sound.id} style={styles.soundRow}>
                {editingName ? (
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    maxLength={60}
                    placeholder={sound.name}
                    placeholderTextColor={theme.neutral.textMuted}
                    style={styles.nameInput}
                    autoFocus
                    onBlur={() => commitName(sound.id, sound.name)}
                    onSubmitEditing={() => commitName(sound.id, sound.name)}
                  />
                ) : (
                  <Text style={styles.soundName} numberOfLines={1}>
                    {sound.name}
                  </Text>
                )}
                {editingName ? (
                  <Button
                    label="Save"
                    size="sm"
                    disabled={busy || !name.trim()}
                    onPress={() => commitName(sound.id, sound.name)}
                  />
                ) : (
                  <>
                    <IconButton
                      icon={SpeakerHighIcon}
                      accessibilityLabel={`Play ${sound.name}`}
                      onPress={() => previewMySound(sound.id)}
                    />
                    <IconButton
                      icon={PencilSimpleIcon}
                      accessibilityLabel={`Rename ${sound.name}`}
                      disabled={busy}
                      onPress={() => {
                        setName(sound.name)
                        setEditingId(sound.id)
                      }}
                    />
                    <IconButton
                      icon={TrashSimpleIcon}
                      accessibilityLabel={`Delete ${sound.name}`}
                      disabled={busy}
                      onPress={() => setDeleteId(sound.id)}
                    />
                  </>
                )}
              </View>
            )
          })}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add sound"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={addSound}
            style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}
          >
            <View style={styles.addIcon}>
              <PlusIcon size={19} color={theme.settingsIcon.sounds} weight="bold" />
            </View>
            <Text style={styles.addText}>Add sound</Text>
          </Pressable>
        </View>
        <Text style={styles.sectionNote}>
          WAV, M4A or MP3, up to 2 MB and 15 seconds. Custom alerts can play any of these.
        </Text>

        {library.sounds.length > 0 && (
          <>
            <SettingsSectionTitle>Overrides</SettingsSectionTitle>
            <View style={styles.pack}>
              {SOUND_OVERRIDE_SLOTS.map(({ slot, label }) => (
                <View key={slot} style={styles.soundRow}>
                  <Text style={styles.soundName}>{label}</Text>
                  <Select
                    options={overrideOptions}
                    value={library.overrides[slot] ?? PACK_OPTION}
                    onChange={(id) =>
                      void run(() => setSoundOverride(slot, id === PACK_OPTION ? null : id))
                    }
                    style={styles.overrideSelect}
                  />
                </View>
              ))}
            </View>
            <Text style={styles.sectionNote}>
              A set override plays instead of the selected pack's sound.
            </Text>
          </>
        )}
      </ScrollView>
      <ConfirmModal
        visible={deleteId !== null}
        title="Delete sound"
        message="Delete this sound? Its overrides return to the pack, and alerts using it play the pack sound."
        confirmLabel="Delete"
        destructive
        onCancel={() => setDeleteId(null)}
        onConfirm={() => {
          const id = deleteId
          setDeleteId(null)
          if (id) void run(() => deleteMySound(id))
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
  voiceSelect: { width: 170 },
  voiceLevel: { gap: 8, marginLeft: 58, marginRight: 14, marginBottom: 14 },
  voiceDescription: { color: theme.neutral.textMuted, fontSize: 12, fontWeight: '500' },
  disabledPacks: { opacity: 0.5 },
  pack: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    backgroundColor: theme.neutral.surfaceDeep,
    overflow: 'hidden',
  },
  activePack: { borderColor: theme.settingsIcon.sounds },
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
  packName: { flex: 1, fontSize: 16, color: theme.neutral.textSecondary, fontWeight: '600' },
  activePackName: { color: theme.neutral.textPrimary, fontWeight: '700' },
  nameInput: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    color: theme.neutral.textPrimary,
  },
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
  addText: { color: theme.settingsIcon.sounds, fontSize: 15, fontWeight: '600' },
  soundRow: {
    minHeight: 56,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.neutral.border,
  },
  soundName: { flex: 1, color: theme.neutral.textPrimary, fontSize: 14, fontWeight: '600' },
  overrideSelect: { width: 170 },
  sectionNote: { color: theme.neutral.textMuted, fontSize: 12, marginHorizontal: 4 },
  pressed: { backgroundColor: interaction.pressedBg },
})
