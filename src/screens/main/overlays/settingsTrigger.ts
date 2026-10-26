import { backupProgressFraction, type BackupSlot } from '@/modules/profile/lib/backupSlot'
import { theme, type ThemeColor } from '@/constants/theme'

export interface SettingsTriggerInput {
  /** A Release Policy escalation: Update Warning or Online Block. */
  versionWarning: boolean
  /** A newer version exists, with nothing forcing the Rider's hand. */
  updateAvailable: boolean
  backup: BackupSlot
  /** A running Maintenance Job, with its 0–1 progress when known; null while none runs. */
  maintenance: { progress: number | null } | null
}

/** Which state, if any, is important enough to wear the Settings button. */
export type SettingsTriggerTakeover = 'update' | 'backup' | 'maintenance' | null

export interface SettingsTriggerState {
  takeover: SettingsTriggerTakeover
  /** Accent for the takeover; undefined while resting. */
  accent: ThemeColor | undefined
  /** 0–1 ring, only for measurable work: a backup drain or a Maintenance Job. */
  progress: number | undefined
  /** Badge color for a state worth noticing but not worth wearing the whole button. */
  dot: ThemeColor | undefined
  accessibilityLabel: string
}

/**
 * What the Settings button wears, given what is happening inside the drawer.
 *
 * One rule, in priority order: a blocked or warned version outranks everything (the app may stop
 * working), a running backup outranks a merely available update (it is happening now and has
 * progress to show), a running Maintenance Job ranks below the backup, and an available update
 * stays a quiet dot the Rider can ignore.
 */
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
