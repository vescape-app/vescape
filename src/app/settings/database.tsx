import { View, StyleSheet, ScrollView, Pressable } from 'react-native'
import { Text } from '@/components/base/Text'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  ClockCounterClockwiseIcon,
  CheckCircleIcon,
  DownloadSimpleIcon,
  UploadSimpleIcon,
  DatabaseIcon,
} from 'phosphor-react-native'

import { theme } from '@/constants/theme'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { Button } from '@/components/base/Button'
import { ProgressBar } from '@/components/base/ProgressBar'
import { ConfirmModal } from '@/components/modals/ConfirmModal'
import { useSettingsDatabaseOps } from '@/modules/settings/hooks/useSettingsDatabaseOps'
import { IconHero } from '@/components/settings/IconHero'

export default function DatabaseSettingsScreen() {
  const db = useSettingsDatabaseOps()

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={DatabaseIcon}
          description="Back up, restore, and rebuild your ride history database."
        />
        <SettingsCard>
          <SettingsRow
            icon={ClockCounterClockwiseIcon}
            label="Rebuild history"
            hint={db.rebuildHint}
            right={
              <Pressable
                style={[
                  styles.rebuildButton,
                  db.rebuildState === 'running' && styles.rebuildButtonDisabled,
                  db.rebuildState === 'done' && styles.rebuildButtonDone,
                ]}
                onPress={() => void db.handleRebuildBuckets()}
                disabled={db.rebuildState === 'running'}
              >
                {db.rebuildState === 'done' && (
                  <CheckCircleIcon size={13} color={theme.palette.green.text} weight="fill" />
                )}
                <Text style={styles.rebuildButtonText}>
                  {db.rebuildState === 'running'
                    ? 'Rebuilding...'
                    : db.rebuildState === 'done'
                      ? 'Done'
                      : 'Rebuild'}
                </Text>
              </Pressable>
            }
          >
            {db.rebuildState === 'running' && (
              <View style={styles.rebuildProgress}>
                <ProgressBar
                  current={db.rebuildProgress?.current ?? 0}
                  total={db.rebuildProgress?.total ?? 0}
                />
              </View>
            )}
          </SettingsRow>
          <SettingsRow
            icon={DownloadSimpleIcon}
            iconColor={theme.palette.green.color}
            label="Back up database"
            hint={db.backupHint}
            right={
              <Button
                label={db.backupState === 'running' ? 'Exporting...' : 'Export'}
                size="sm"
                variant="secondary"
                loading={db.backupState === 'running'}
                disabled={db.restoreState === 'running' || db.rebuildState === 'running'}
                onPress={db.handleBackupDatabase}
              />
            }
          />
          <SettingsRow
            icon={UploadSimpleIcon}
            iconColor={theme.status.warning.color}
            label="Restore database"
            hint={db.restoreHint}
            right={
              <Button
                label={db.restoreState === 'running' ? 'Restoring...' : 'Restore'}
                size="sm"
                variant="destructive"
                loading={db.restoreState === 'running'}
                disabled={db.backupState === 'running' || db.rebuildState === 'running'}
                onPress={() => void db.handleRestoreDatabase()}
              />
            }
          />
        </SettingsCard>
      </ScrollView>
      <ConfirmModal
        visible={db.restoreConfirmVisible}
        title="Restore database"
        message={`Current database will be replaced by ${db.pendingRestoreName ?? 'the selected backup'}. App keeps a temporary rollback copy during restore and restores old database if restore fails.`}
        confirmLabel="Restore"
        destructive
        onConfirm={() => void db.handleConfirmRestore()}
        onCancel={db.cancelRestore}
      />
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
  rebuildButton: {
    backgroundColor: theme.neutral.surfaceDeep,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  rebuildButtonDisabled: {
    opacity: 0.5,
  },
  rebuildButtonDone: {
    borderColor: theme.palette.green.border,
    backgroundColor: theme.palette.green.bg,
  },
  rebuildButtonText: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  rebuildProgress: {
    marginHorizontal: 14,
    marginBottom: 12,
  },
})
