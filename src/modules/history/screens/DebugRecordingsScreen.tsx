import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { PackageIcon, RecordIcon, TrashIcon } from 'phosphor-react-native'
import { router } from 'expo-router'

import { Button } from '@/components/base/Button'
import { ConfirmModal } from '@/components/modals/ConfirmModal'
import { IconHero } from '@/components/settings/IconHero'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
import { theme } from '@/constants/theme'
import { formatBytes } from '@/helpers/format'
import { useDebugRecordings } from '@/modules/history/hooks/useDebugRecordings'

function formatCreatedAt(createdAt: number): string {
  return new Date(createdAt).toLocaleString()
}

export function DebugRecordingsScreen() {
  const debug = useDebugRecordings()
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const busy =
    debug.replayingName != null || debug.exportingName != null || debug.deletingName != null

  const confirmDelete = async () => {
    if (!pendingDelete) return
    await debug.deleteRecording(pendingDelete)
    setPendingDelete(null)
  }

  const startReplay = async (name: string) => {
    const started = await debug.replayRecording(name)
    // Replay drives the normal live UI — jump back to the main screen to watch it.
    if (started) router.dismissAll()
  }

  const replayButton = (name: string) => (
    <Button
      label={debug.replayingName === name ? 'Starting...' : 'Replay'}
      size="sm"
      variant="secondary"
      loading={debug.replayingName === name}
      disabled={busy}
      onPress={() => void startReplay(name)}
    />
  )

  return (
    <>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={RecordIcon}
          description="Capture raw BLE packets, connection states, and location for diagnosis."
        />

        <SettingsSectionTitle>Capture</SettingsSectionTitle>
        <SettingsCard>
          <SettingsRow
            icon={RecordIcon}
            iconWeight="fill"
            iconColor={theme.status.warning.color}
            label="Record future sessions"
            hint="Applies to every new board session until disabled"
            right={
              <Switch
                value={debug.enabled}
                onValueChange={debug.setEnabled}
                trackColor={{
                  false: theme.neutral.border,
                  true: theme.status.warning.border,
                }}
                thumbColor={debug.enabled ? theme.status.warning.color : theme.neutral.textMuted}
              />
            }
          />
        </SettingsCard>

        <View style={styles.recordingsHeading}>
          <SettingsSectionTitle>Recordings</SettingsSectionTitle>
          <Pressable onPress={() => void debug.refresh()} disabled={debug.loading}>
            <Text style={styles.refreshText}>{debug.loading ? 'Loading...' : 'Refresh'}</Text>
          </Pressable>
        </View>

        {debug.error ? (
          <Text style={styles.errorText} selectable>
            {debug.error}
          </Text>
        ) : null}
        {debug.loading ? (
          <ActivityIndicator color={theme.palette.sky.color} />
        ) : debug.recordings.length === 0 ? (
          <Text style={styles.emptyText}>No debug recordings yet.</Text>
        ) : (
          <SettingsCard>
            {debug.recordings.map((recording) => (
              <SettingsRow
                key={recording.name}
                icon={RecordIcon}
                iconColor={theme.palette.sky.color}
                label={recording.name}
                hint={`device · ${formatCreatedAt(recording.createdAt)} · ${formatBytes(recording.sizeBytes)}`}
                right={
                  <View style={styles.rowActions}>
                    {replayButton(recording.name)}
                    <Button
                      label={debug.exportingName === recording.name ? 'Exporting...' : 'Export'}
                      size="sm"
                      variant="secondary"
                      loading={debug.exportingName === recording.name}
                      disabled={busy}
                      onPress={() => void debug.exportRecording(recording)}
                    />
                    <Pressable
                      hitSlop={8}
                      disabled={busy}
                      onPress={() => setPendingDelete(recording.name)}
                      style={styles.deleteButton}
                    >
                      {debug.deletingName === recording.name ? (
                        <ActivityIndicator size="small" color={theme.status.error.color} />
                      ) : (
                        <TrashIcon size={20} color={theme.status.error.color} />
                      )}
                    </Pressable>
                  </View>
                }
              />
            ))}
          </SettingsCard>
        )}

        {debug.fixtures.length > 0 && (
          <>
            <SettingsSectionTitle>Bundled fixtures</SettingsSectionTitle>
            <SettingsCard>
              {debug.fixtures.map((fixture) => (
                <SettingsRow
                  key={fixture.name}
                  icon={PackageIcon}
                  iconColor={theme.neutral.textSecondary}
                  label={fixture.name}
                  hint={`bundled · ${formatBytes(fixture.sizeBytes)}`}
                  right={replayButton(fixture.name)}
                />
              ))}
            </SettingsCard>
          </>
        )}
      </ScrollView>
      <ConfirmModal
        visible={pendingDelete != null}
        title="Delete recording?"
        message={`Permanently delete "${pendingDelete ?? ''}". This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        loading={debug.deletingName != null}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  )
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    padding: 16,
    gap: 8,
    backgroundColor: theme.neutral.bg,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  deleteButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingsHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  refreshText: {
    color: theme.palette.sky.color,
    fontSize: 13,
    fontWeight: '700',
  },
  errorText: {
    color: theme.status.error.color,
    fontSize: 12,
  },
  emptyText: {
    color: theme.neutral.textMuted,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20,
  },
})
