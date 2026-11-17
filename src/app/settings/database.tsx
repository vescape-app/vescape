import { PageScrollView } from '@/components/base/PageScrollView'
import { View, StyleSheet } from 'react-native'
import { Text } from '@/components/base/Text'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  ClockCounterClockwiseIcon,
  DownloadSimpleIcon,
  UploadSimpleIcon,
  DatabaseIcon,
  WarningCircleIcon,
} from 'phosphor-react-native'

import { theme } from '@/constants/theme'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
import { Button } from '@/components/base/Button'
import { ConfirmModal } from '@/components/modals/ConfirmModal'
import { useSettingsDatabaseOps } from '@/modules/settings/hooks/useSettingsDatabaseOps'
import { IconHero } from '@/components/settings/IconHero'
import {
  maintenanceJobDetail,
  maintenanceJobTitle,
  maintenanceProgress,
} from '@/modules/settings/lib/maintenance'
import { useMaintenanceStore } from '@/modules/settings/store/maintenanceStore'

export default function DatabaseSettingsScreen() {
  const db = useSettingsDatabaseOps()
  const maintenance = useMaintenanceStore((s) => s.state)
  const progress = maintenanceProgress(maintenance)

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <PageScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={DatabaseIcon}
          description="Back up and restore your ride history database."
        />
        {db.dbSizeError ? <Text style={styles.error}>{db.dbSizeError}</Text> : null}
        <SettingsCard>
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
                disabled={db.restoreState === 'running'}
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
                disabled={db.backupState === 'running'}
                onPress={() => void db.handleRestoreDatabase()}
              />
            }
          />
        </SettingsCard>
        <SettingsSectionTitle>Maintenance</SettingsSectionTitle>
        <Text style={styles.sectionHint}>
          Runs automatically in the background. Nothing to do here.
        </Text>
        <SettingsCard>
          {(maintenance?.jobs ?? []).map((job) => (
            <SettingsRow
              key={job.id}
              icon={job.status === 'failed' ? WarningCircleIcon : ClockCounterClockwiseIcon}
              iconColor={job.status === 'failed' ? theme.status.warning.color : undefined}
              label={maintenanceJobTitle(job.id)}
              hint={maintenanceJobDetail(job)}
            >
              {job.id === progress?.job.id && progress.fraction != null ? (
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${Math.round(progress.fraction * 100)}%` },
                    ]}
                  />
                </View>
              ) : null}
            </SettingsRow>
          ))}
        </SettingsCard>
      </PageScrollView>
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
  error: {
    color: theme.status.error.text,
    fontSize: 12,
    textAlign: 'center',
  },
  sectionHint: {
    color: theme.neutral.textMuted,
    fontSize: 12,
    marginHorizontal: 4,
    marginBottom: 4,
  },
  /** Under the running row's text: row padding 14 + icon 32 + gap 12. */
  progressTrack: {
    marginLeft: 58,
    marginRight: 14,
    marginTop: -6,
    marginBottom: 14,
    height: 3,
    backgroundColor: theme.neutral.surfaceDeep,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.settingsIcon.database,
  },
})
