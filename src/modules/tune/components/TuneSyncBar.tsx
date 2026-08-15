import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import {
  ArrowCounterClockwiseIcon,
  ArrowsClockwiseIcon,
  BluetoothSlashIcon,
  CheckCircleIcon,
  CloudArrowUpIcon,
  CheckIcon,
  DownloadSimpleIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
} from 'phosphor-react-native'

import type { SyncBarState } from '@/modules/tune/lib/syncBarState'
import { theme } from '@/constants/theme'

interface TuneSyncBarProps {
  state: SyncBarState | null
  onSave: () => void
  onSaveAndSync: () => void
  onSync: () => void
  onUpdateTune: () => void
  onDiscard: () => void
  onRetryConfig: () => void
  bottomOffset?: number
}

export function TuneSyncBar({
  state,
  onSave,
  onSaveAndSync,
  onSync,
  onUpdateTune,
  onDiscard,
  onRetryConfig,
  bottomOffset = 16,
}: TuneSyncBarProps) {
  if (!state) return null

  const config = getConfig(state)

  return (
    <View style={[styles.wrapper, { bottom: bottomOffset }]} pointerEvents="box-none">
      <View style={[styles.pill, { borderColor: config.borderColor }]}>
        <View style={styles.left}>
          {config.icon}
          <View style={styles.message}>
            <Text style={[styles.text, { color: config.textColor }]} numberOfLines={1}>
              {config.text}
            </Text>
            {config.detail ? (
              <Text style={styles.detailText} numberOfLines={2}>
                {config.detail}
              </Text>
            ) : null}
          </View>
        </View>

        {config.actions.length > 0 ? (
          <View style={styles.actions}>
            {config.actions.map((action) => (
              <Pressable
                key={action.label}
                style={[
                  styles.actionBtn,
                  action.primary ? styles.actionBtnPrimary : styles.actionBtnSecondary,
                  action.primary ? { backgroundColor: config.accentColor } : undefined,
                ]}
                onPress={action.onPress}
              >
                {action.icon}
                <Text
                  style={[
                    styles.actionText,
                    action.primary ? { color: config.accentTextColor } : undefined,
                  ]}
                >
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  )

  function getConfig(s: SyncBarState) {
    switch (s.variant) {
      case 'loading_config':
        return {
          borderColor: theme.palette.sky.border,
          textColor: theme.palette.sky.text,
          accentColor: theme.palette.sky.color,
          accentTextColor: theme.neutral.surfaceDeep,
          text: 'Reading board config...',
          detail: null,
          icon: <ActivityIndicator size="small" color={theme.palette.sky.color} />,
          actions: [],
        }
      case 'config_error':
        return {
          borderColor: theme.status.warning.border,
          textColor: theme.status.warning.text,
          accentColor: theme.status.warning.color,
          accentTextColor: theme.neutral.surfaceDeep,
          text: 'Board config not read',
          detail: s.configError,
          icon: <WarningCircleIcon size={16} color={theme.status.warning.color} weight="bold" />,
          actions: [
            {
              label: 'Retry',
              primary: true,
              icon: (
                <ArrowsClockwiseIcon size={12} color={theme.neutral.surfaceDeep} weight="bold" />
              ),
              onPress: onRetryConfig,
            },
          ],
        }
      case 'up_to_date':
        return {
          borderColor: theme.neutral.border,
          textColor: theme.neutral.textMuted,
          accentColor: theme.palette.green.color,
          accentTextColor: theme.palette.green.bg,
          text: 'Your board is up to date',
          detail: null,
          icon: <CheckCircleIcon size={16} color={theme.palette.green.color} weight="fill" />,
          actions: [],
        }
      case 'connect_to_sync':
        return {
          borderColor: theme.status.warning.border,
          textColor: theme.status.warning.text,
          accentColor: theme.status.warning.color,
          accentTextColor: theme.neutral.surfaceDeep,
          text: 'Connect to board to sync',
          detail: null,
          icon: <BluetoothSlashIcon size={16} color={theme.status.warning.color} weight="bold" />,
          actions: [],
        }
      case 'save_later':
        return {
          borderColor: theme.palette.sky.border,
          textColor: theme.neutral.textPrimary,
          accentColor: theme.palette.sky.color,
          accentTextColor: theme.neutral.surfaceDeep,
          text: `${s.dirtyCount} unsaved field${s.dirtyCount === 1 ? '' : 's'}`,
          detail: s.configError ? `Board config not read: ${s.configError}` : null,
          icon: <CloudArrowUpIcon size={16} color={theme.palette.sky.color} weight="bold" />,
          actions: s.configError
            ? [
                {
                  label: 'Retry',
                  primary: false,
                  icon: (
                    <ArrowsClockwiseIcon
                      size={12}
                      color={theme.neutral.textSecondary}
                      weight="bold"
                    />
                  ),
                  onPress: onRetryConfig,
                },
                {
                  label: 'Save',
                  primary: true,
                  icon: <CheckIcon size={12} color={theme.neutral.surfaceDeep} weight="bold" />,
                  onPress: onSave,
                },
              ]
            : [
                {
                  label: 'Discard',
                  primary: false,
                  icon: (
                    <ArrowCounterClockwiseIcon
                      size={12}
                      color={theme.neutral.textSecondary}
                      weight="bold"
                    />
                  ),
                  onPress: onDiscard,
                },
                {
                  label: 'Save',
                  primary: true,
                  icon: <CheckIcon size={12} color={theme.neutral.surfaceDeep} weight="bold" />,
                  onPress: onSave,
                },
              ],
        }
      case 'save_and_sync':
        return {
          borderColor: theme.palette.sky.border,
          textColor: theme.neutral.textPrimary,
          accentColor: theme.palette.sky.color,
          accentTextColor: theme.neutral.surfaceDeep,
          text: `${s.dirtyCount} unsaved field${s.dirtyCount === 1 ? '' : 's'}`,
          detail: null,
          icon: <ArrowsClockwiseIcon size={16} color={theme.palette.sky.color} weight="bold" />,
          actions: [
            {
              label: 'Discard',
              primary: false,
              icon: (
                <ArrowCounterClockwiseIcon
                  size={12}
                  color={theme.palette.slate.text}
                  weight="bold"
                />
              ),
              onPress: onDiscard,
            },
            {
              label: 'Save & sync',
              primary: true,
              icon: <CheckIcon size={12} color={theme.neutral.surfaceDeep} weight="bold" />,
              onPress: onSaveAndSync,
            },
          ],
        }
      case 'sync_with_board':
        return {
          borderColor: theme.palette.sky.border,
          textColor: theme.palette.sky.text,
          accentColor: theme.palette.sky.color,
          accentTextColor: theme.neutral.surfaceDeep,
          text: `${s.diffCount} field${s.diffCount === 1 ? '' : 's'} differ from board`,
          detail: null,
          icon: <ArrowsClockwiseIcon size={16} color={theme.palette.sky.color} weight="bold" />,
          actions: [
            {
              label: 'Update tune',
              primary: false,
              icon: (
                <DownloadSimpleIcon size={12} color={theme.neutral.textSecondary} weight="bold" />
              ),
              onPress: onUpdateTune,
            },
            {
              label: 'Send to board',
              primary: true,
              icon: <UploadSimpleIcon size={12} color={theme.neutral.surfaceDeep} weight="bold" />,
              onPress: onSync,
            },
          ],
        }
      case 'saving':
        return {
          borderColor: theme.palette.sky.border,
          textColor: theme.palette.sky.text,
          accentColor: theme.palette.sky.color,
          accentTextColor: theme.neutral.surfaceDeep,
          text: 'Saving...',
          detail: null,
          icon: <ActivityIndicator size="small" color={theme.palette.sky.color} />,
          actions: [],
        }
      case 'syncing':
        return {
          borderColor: theme.palette.green.border,
          textColor: theme.palette.green.text,
          accentColor: theme.palette.green.color,
          accentTextColor: theme.palette.green.bg,
          text: 'Syncing to board...',
          detail: null,
          icon: <ActivityIndicator size="small" color={theme.palette.green.color} />,
          actions: [],
        }
    }
  }
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 30,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: 24,
    borderWidth: 1,
    gap: 8,
    backgroundColor: theme.control.background,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    overflow: 'hidden',
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
  },
  message: {
    flexShrink: 1,
    minWidth: 0,
    gap: 2,
    paddingRight: 10,
  },
  detailText: {
    color: theme.control.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: 4,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    gap: 5,
  },
  actionBtnPrimary: {
    // backgroundColor set inline with accentColor
  },
  actionBtnSecondary: {
    borderWidth: 1,
    borderColor: theme.neutral.border,
    backgroundColor: theme.neutral.surfaceDeep,
  },
  actionText: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
})
