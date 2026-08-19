import { Platform, Pressable, StyleSheet, View } from 'react-native'
import Constants from 'expo-constants'
import { router, type Href } from 'expo-router'
import {
  ArrowFatLinesUpIcon,
  ArrowsClockwiseIcon,
  BluetoothConnectedIcon,
  CheckCircleIcon,
  DatabaseIcon,
  GaugeIcon,
  HouseIcon,
  WatchIcon,
  WrenchIcon,
  type Icon,
} from 'phosphor-react-native'
import { openAppUpdate } from 'vescape-core'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { VescapeWordmark } from '@/components/base/VescapeWordmark'
import { LinkWidget } from '@/components/widgets/LinkWidget'
import { secondaryWidgetSurface } from '@/components/widgets/widgetSurface'
import { AccountPill } from '@/modules/profile/components/AccountPill'
import { DASH, fmtCompactCount, fmtTimeAgo, formatBytes } from '@/helpers/format'
import { backupProgressFraction, type BackupSlot } from '@/modules/profile/lib/backupSlot'
import { selectAvailableUpdate } from '@/modules/release/lib/availableUpdate'
import { useAppStatusStore } from '@/modules/release/store/appStatusStore'
import { useDatabaseSize } from '@/modules/settings/hooks/useDatabaseSize'
import { routes } from '@/navigation/routes'
import { theme } from '@/constants/theme'

const appVersion = Constants.expoConfig?.version ?? DASH

interface Shortcut {
  icon: Icon
  accent: string
  label: string
  hint: string
  route: Href
  androidOnly?: boolean
}

/** The settings a Rider reaches for often enough to deserve a place outside Advanced. */
const SHORTCUTS: Shortcut[] = [
  {
    icon: BluetoothConnectedIcon,
    accent: theme.settingsIcon.connection,
    label: 'Connection',
    hint: 'Auto start, auto connect, and sounds',
    route: routes.settingsConnection,
  },
  {
    icon: GaugeIcon,
    accent: theme.settingsIcon.liveTelemetry,
    label: 'Live telemetry',
    hint: 'Graphs, update rate, and battery smoothing',
    route: routes.settingsLiveTelemetry,
  },
  {
    icon: WatchIcon,
    accent: theme.settingsIcon.watch,
    label: 'Watch',
    hint: 'Auto open and telemetry push rate',
    route: routes.settingsWatch,
    androidOnly: true,
  },
  {
    icon: HouseIcon,
    accent: theme.settingsIcon.privacyZones,
    label: 'Privacy zones',
    hint: 'Skip recording near saved places',
    route: routes.settingsPrivacyZones,
  },
]

interface SettingsSheetProps {
  backup: BackupSlot
  /** Called before navigating away so the host can dismiss the drawer. */
  onNavigate: () => void
}

/**
 * Contents of the Settings Drawer: who you are, what the app is doing for you right now (backup,
 * update, storage), the settings worth one tap, and one door to everything else.
 */
export function SettingsSheet({ backup, onNavigate }: SettingsSheetProps) {
  const dbSize = useDatabaseSize().bytes
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

      <View style={styles.strip}>
        <BackupCell backup={backup} onSignIn={() => go(routes.signIn)} />
        <View style={styles.stripDivider} />
        <StripCell
          icon={availableUpdate ? ArrowFatLinesUpIcon : CheckCircleIcon}
          accent={availableUpdate ? theme.settingsIcon.update : theme.status.success.color}
          value={`v${appVersion}`}
          label={availableUpdate ? 'Update ready' : 'Up to date'}
          onPress={() => go(routes.settingsReleaseNotes)}
          accessibilityLabel="Release notes"
        />
        <View style={styles.stripDivider} />
        <StripCell
          icon={DatabaseIcon}
          accent={theme.settingsIcon.database}
          value={dbSize != null ? formatBytes(dbSize) : DASH}
          label="Storage"
          onPress={() => go(routes.settingsDatabase)}
          accessibilityLabel="Database and storage"
        />
      </View>

      {availableUpdate ? (
        <Button
          label={`Update to v${availableUpdate.latestVersion}`}
          icon={ArrowFatLinesUpIcon}
          onPress={openAppUpdate}
          style={styles.updateButton}
          accessibilityLabel={`Update Vescape to version ${availableUpdate.latestVersion}`}
        />
      ) : null}

      {SHORTCUTS.filter((s) => !s.androidOnly || Platform.OS === 'android').map((s) => (
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
        label="Advanced settings"
        hint="Diagnostics, map, filters, and developer tools"
        onPress={() => go(routes.settings)}
      />
    </View>
  )
}

/** The backup third of the status strip — the only cell whose value can be a live count. */
function BackupCell({ backup, onSignIn }: { backup: BackupSlot; onSignIn: () => void }) {
  const accent = theme.settingsIcon.sync

  if (backup.kind === 'signedOut') {
    return (
      <StripCell
        icon={ArrowsClockwiseIcon}
        accent={theme.palette.slate.textMuted}
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
        accent={theme.palette.slate.textMuted}
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

  // Syncing: the bar carries "in progress", so the label underneath would only repeat it.
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

interface StripCellProps {
  icon: Icon
  accent: string
  value: string
  label?: string
  valueColor?: string
  /** 0–1. Draws a bar under the value; the bar alone says the work is running. */
  progress?: number
  dim?: boolean
  onPress?: () => void
  accessibilityLabel: string
}

/** One third of the status strip: glyph, one value, one line about it. */
function StripCell({
  icon: IconComponent,
  accent,
  value,
  label,
  valueColor,
  progress,
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
      <IconComponent size={18} color={accent} weight="duotone" />
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
    // The drawer opens from the top edge, so the wordmark needs room to read as a header
    // rather than as the first row of the list.
    gap: 22,
    paddingTop: 24,
    paddingBottom: 10,
  },
  dim: {
    opacity: 0.5,
  },
  strip: {
    ...secondaryWidgetSurface,
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: 14,
    marginBottom: 10,
  },
  stripCell: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 4,
  },
  stripDivider: {
    width: 1,
    backgroundColor: theme.neutral.border,
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
