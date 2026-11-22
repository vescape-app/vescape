import { backupProgressFraction, type BackupSlot } from '@/modules/profile/lib/backupSlot'
import { theme, type ThemeColor } from '@/constants/theme'

export interface SettingsTriggerInput {
  versionWarning: boolean
  updateAvailable: boolean
  backup: BackupSlot
  maintenance: { progress: number | null } | null
}

export type SettingsTriggerTakeover = 'update' | 'backup' | 'maintenance' | null

export interface SettingsTriggerState {
  takeover: SettingsTriggerTakeover
  accent: ThemeColor | undefined
  progress: number | undefined
  dot: ThemeColor | undefined
  accessibilityLabel: string
}

export function settingsTriggerState({
  versionWarning,
  updateAvailable,
  backup,
  maintenance,
}: SettingsTriggerInput): SettingsTriggerState {
  if (versionWarning) {
    return {
      takeover: 'update',
      accent: theme.status.upgrade.color,
      progress: undefined,
      dot: undefined,
      accessibilityLabel: 'Settings, update required',
    }
  }

  const dot = updateAvailable ? theme.status.upgrade.color : undefined

  if (backup.kind === 'syncing') {
    return {
      takeover: 'backup',
      accent: theme.settingsIcon.sync,
      progress: backupProgressFraction(backup) ?? undefined,
      dot,
      accessibilityLabel: 'Settings, backing up rides',
    }
  }

  if (maintenance) {
    return {
      takeover: 'maintenance',
      accent: theme.settingsIcon.database,
      progress: maintenance.progress ?? undefined,
      dot,
      accessibilityLabel: 'Settings, updating ride data',
    }
  }

  return {
    takeover: null,
    accent: undefined,
    progress: undefined,
    dot,
    accessibilityLabel: updateAvailable ? 'Settings, update available' : 'Settings',
  }
}
