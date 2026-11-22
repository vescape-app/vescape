import { Pressable, StyleSheet, View } from 'react-native'
import Constants from 'expo-constants'
import { router, type Href } from 'expo-router'
import {
  ArrowFatLinesUpIcon,
  ArrowsClockwiseIcon,
  BluetoothConnectedIcon,
  CheckCircleIcon,
  DatabaseIcon,
  WatchIcon,
  WrenchIcon,
  type Icon,
} from 'phosphor-react-native'
import { openAppUpdate } from 'vescape-core'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { VescapeWordmark } from '@/components/base/VescapeWordmark'
import { LinkWidget } from '@/components/widgets/LinkWidget'
import { useResolvedSecondaryWidgetSurface } from '@/components/widgets/widgetSurface'
import { AccountPill } from '@/modules/profile/components/AccountPill'
import { DASH, fmtCompactCount, fmtTimeAgo, formatBytes } from '@/helpers/format'
import { backupProgressFraction, type BackupSlot } from '@/modules/profile/lib/backupSlot'
import { selectAvailableUpdate } from '@/modules/release/lib/availableUpdate'
import { useAppStatusStore } from '@/modules/release/store/appStatusStore'
import { useDatabaseSize } from '@/modules/settings/hooks/useDatabaseSize'
import {
  maintenanceFailed,
  maintenanceProgress,
  type MaintenanceProgress,
} from '@/modules/settings/lib/maintenance'
import { useMaintenanceStore } from '@/modules/settings/store/maintenanceStore'
import { ThemePicker } from '@/modules/settings/components/ThemePicker'
import { routes } from '@/navigation/routes'
import { theme, type ThemeColor } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'

const appVersion = Constants.expoConfig?.version ?? DASH

interface Shortcut {
  icon: Icon
  accent: ThemeColor
  label: string
  hint: string
  route: Href
}

const SHORTCUTS: Shortcut[] = [
  {
    icon: BluetoothConnectedIcon,
    accent: theme.settingsIcon.automation,
    label: 'Automation',
    hint: 'Auto start, auto connect, and recording',
    route: routes.settingsAutomation,
  },
  {
    icon: WatchIcon,
    accent: theme.settingsIcon.watch,
    label: 'Watch',
    hint: 'Push rate and what the wrist shows',
    route: routes.settingsWatch,
  },
]

interface SettingsSheetProps {
  backup: BackupSlot
  onNavigate: () => void
}

export function SettingsSheet({ backup, onNavigate }: SettingsSheetProps) {
  const neutral = useResolvedNeutralColors()
  const secondarySurface = useResolvedSecondaryWidgetSurface()
  const dbSize = useDatabaseSize().bytes
  const maintenanceState = useMaintenanceStore((s) => s.state)
  const maintenance = maintenanceProgress(maintenanceState)
  const maintenanceHasFailed = maintenanceFailed(maintenanceState)
  const appStatus = useAppStatusStore((s) => s.status)
  const availableUpdate = selectAvailableUpdate(appStatus)

  const go = (route: Href) => {
    onNavigate()
    router.push(route)
  }

  return (
    <View testID="settings-sheet" style={styles.list}>
      <View style={styles.hero}>
        <VescapeWordmark width={170} />
        <AccountPill onNavigate={onNavigate} />
      </View>

      <View style={[styles.strip, secondarySurface]}>
        <BackupCell backup={backup} onSignIn={() => go(routes.signIn)} />
        <View style={[styles.stripDivider, { backgroundColor: neutral.border }]} />
        <StripCell
          icon={availableUpdate ? ArrowFatLinesUpIcon : CheckCircleIcon}
          accent={availableUpdate ? theme.settingsIcon.update : theme.status.success.color}
          value={`v${appVersion}`}
          label={availableUpdate ? 'Update ready' : 'Up to date'}
          onPress={() => go(routes.settingsReleaseNotes)}
          accessibilityLabel="Release notes"
        />
        <View style={[styles.stripDivider, { backgroundColor: neutral.border }]} />
        <StorageCell
          bytes={dbSize}
          progress={maintenance}
          failed={maintenanceHasFailed}
          onPress={() => go(routes.settingsDatabase)}
        />
      </View>

      <ThemePicker />

      {availableUpdate ? (
        <Button
          label={`Update to v${availableUpdate.latestVersion}`}
          icon={ArrowFatLinesUpIcon}
          onPress={openAppUpdate}
          style={styles.updateButton}
          accessibilityLabel={`Update Vescape to version ${availableUpdate.latestVersion}`}
        />
      ) : null}

      {SHORTCUTS.map((s) => (
        <LinkWidget
          key={s.label}
          icon={s.icon}
          accent={s.accent}
          label={s.label}
          hint={s.hint}
          onPress={() => go(s.route)}
        />
      ))}

      <LinkWidget
        icon={WrenchIcon}
        accent={theme.settingsIcon.advanced}
        label="More settings"
        hint="Sounds, map, devices, and more"
        onPress={() => go(routes.settings)}
      />
    </View>
  )
}

function BackupCell({ backup, onSignIn }: { backup: BackupSlot; onSignIn: () => void }) {
  const accent = theme.settingsIcon.sync

  if (backup.kind === 'signedOut') {
    return (
      <StripCell
        icon={ArrowsClockwiseIcon}
        accent={theme.neutral.textMuted}
        value="Sync"
        label="No account"
        dim
        onPress={onSignIn}
        accessibilityLabel="Sign in to back up your rides"
      />
    )
  }

  if (backup.kind === 'unavailable') {
    return (
      <StripCell
        icon={ArrowsClockwiseIcon}
        accent={theme.neutral.textMuted}
        value="Sync"
        label="Unavailable"
        dim
        accessibilityLabel="Backup is not available in this build"
      />
    )
  }

  if (backup.kind === 'idle') {
    return (
      <StripCell
        icon={ArrowsClockwiseIcon}
        accent={accent}
        value="Backed up"
        label={backup.lastUploadAtMs != null ? fmtTimeAgo(backup.lastUploadAtMs) : DASH}
        accessibilityLabel="Rides are backed up"
      />
    )
  }

  return (
    <StripCell
      icon={ArrowsClockwiseIcon}
      accent={accent}
      value={`${fmtCompactCount(backup.current)}/${fmtCompactCount(backup.total)}`}
      valueColor={accent}
      progress={backupProgressFraction(backup) ?? undefined}
      accessibilityLabel={`Backing up, ${backup.current} of ${backup.total} rows`}
    />
  )
}

interface StorageCellProps {
  bytes: number | null
  progress: MaintenanceProgress | null
  failed: boolean
  onPress?: () => void
}

export function StorageCell({ bytes, progress, failed, onPress }: StorageCellProps) {
  const accent = theme.settingsIcon.database
  const value = progress
    ? `${Math.round((progress.fraction ?? 0) * 100)}%`
    : bytes != null
      ? formatBytes(bytes)
      : DASH
  return (
    <StripCell
      icon={DatabaseIcon}
      accent={accent}
      value={value}
      valueColor={progress ? accent : undefined}
      label={progress ? 'Updating' : 'Storage'}
      dot={failed ? theme.status.warning.color : undefined}
      onPress={onPress}
      accessibilityLabel={
        progress
          ? `Database and storage, ${progress.statusLine}`
          : failed
            ? 'Database and storage, ride data update failed'
            : 'Database and storage'
      }
    />
  )
}

interface StripCellProps {
  icon: Icon
  accent: ThemeColor
  value: string
  label?: string
  valueColor?: ThemeColor
  progress?: number
  dot?: ThemeColor
  dim?: boolean
  onPress?: () => void
  accessibilityLabel: string
}

function StripCell({
  icon: IconComponent,
  accent,
  value,
  label,
  valueColor,
  progress,
  dot,
  dim,
  onPress,
  accessibilityLabel,
}: StripCellProps) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.stripCell,
        dim && styles.dim,
        pressed && onPress ? { opacity: theme.interaction.pressedOpacity } : null,
      ]}
      onPress={onPress}
      disabled={!onPress}
      accessibilityLabel={accessibilityLabel}
    >
      <View>
        <IconComponent size={18} color={accent} weight="duotone" />
        {dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : null}
      </View>
      <Text
        style={[styles.stripValue, valueColor ? { color: valueColor } : null]}
        numberOfLines={1}
      >
        {value}
      </Text>
      {progress != null ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
      ) : null}
      {label ? <Text style={styles.stripLabel}>{label}</Text> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  list: {
    gap: 12,
  },
  hero: {
    alignItems: 'center',
    gap: 22,
    paddingTop: 24,
    paddingBottom: 10,
  },
  dim: {
    opacity: 0.5,
  },
  dot: {
    position: 'absolute',
    top: -2,
    right: -4,
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  strip: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginBottom: 10,
    overflow: 'hidden',
  },
  stripCell: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  stripDivider: {
    width: StyleSheet.hairlineWidth * 2,
  },
  stripValue: {
    color: theme.neutral.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  stripLabel: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  progressTrack: {
    height: 4,
    width: 56,
    marginTop: 4,
    marginBottom: 2,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: theme.palette.cyan.bg,
    borderWidth: 1,
    borderColor: theme.palette.cyan.border,
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.settingsIcon.sync,
  },
  updateButton: {
    backgroundColor: theme.status.upgrade.color,
  },
})
