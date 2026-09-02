import { backupProgressFraction, type BackupSlot } from '@/modules/profile/lib/backupSlot'
import { theme } from '@/constants/theme'

export interface SettingsTriggerInput {
  /** A Release Policy escalation: Update Warning or Online Block. */
  versionWarning: boolean
  /** A newer version exists, with nothing forcing the Rider's hand. */
  updateAvailable: boolean
  backup: BackupSlot
}

/** Which state, if any, is important enough to wear the Settings button. */
export type SettingsTriggerTakeover = 'update' | 'backup' | null

export interface SettingsTriggerState {
  takeover: SettingsTriggerTakeover
  /** Accent for the takeover; undefined while resting. */
  accent: string | undefined
  /** 0–1 ring, only for a measurable backup drain. */
  progress: number | undefined
  /** Badge color for a state worth noticing but not worth wearing the whole button. */
  dot: string | undefined
  accessibilityLabel: string
}

/**
 * What the Settings button wears, given what is happening inside the drawer.
 *
 * One rule, in priority order: a blocked or warned version outranks everything (the app may stop
 * working), a running backup outranks a merely available update (it is happening now and has
 * progress to show), and an available update stays a quiet dot the Rider can ignore. A paused
 * backup needs the Rider to act, so it takes the dot over an update that does not.
 */
export function settingsTriggerState({
  versionWarning,
  updateAvailable,
  backup,
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

  const paused = backup.kind === 'blocked' && backup.reason === 'paused'
  const dot = paused
    ? theme.status.error.color
    : updateAvailable
      ? theme.status.upgrade.color
      : undefined

  if (backup.kind === 'syncing') {
    return {
      takeover: 'backup',
      accent: theme.settingsIcon.sync,
      progress: backupProgressFraction(backup) ?? undefined,
      dot,
      accessibilityLabel: 'Settings, backing up rides',
    }
  }

  return {
    takeover: null,
    accent: undefined,
    progress: undefined,
    dot,
    accessibilityLabel: paused
      ? 'Settings, backup paused'
      : updateAvailable
        ? 'Settings, update available'
        : 'Settings',
  }
}
