import { forwardRef, type RefObject } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import {
  CaretDownIcon,
  EngineIcon,
  PencilSimpleIcon,
  PowerIcon,
  RecordIcon,
  WarningDiamondIcon,
  type Icon,
} from 'phosphor-react-native'
import type { BoardWarningSeverity } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { ReplayBadge } from '@/modules/board/components/ReplayBadge'
import { severityStatus } from '@/modules/board/constants/boardWarnings'
import { theme } from '@/constants/theme'

interface PillAction {
  onPress: () => void
  ref?: RefObject<View | null>
}

interface BoardPillProps {
  maxWidth: number
  name: string | null
  bleStatus: string
  replay?: boolean
  onOpenSelector: () => void
  onEdit?: () => void
  onDisconnect: () => void
  onStopRecording?: () => void
  warning?: PillAction & { severity: BoardWarningSeverity }
  fault?: PillAction
}

/** Shared presentation for the live board bar and its state-controlled design preview. */
export const BoardPill = forwardRef<View, BoardPillProps>(function BoardPill(
  {
    maxWidth,
    name,
    bleStatus,
    replay,
    onOpenSelector,
    onEdit,
    onDisconnect,
    onStopRecording,
    warning,
    fault,
  },
  ref,
) {
  const canDisconnect =
    bleStatus === 'connected' ||
    bleStatus === 'stale' ||
    bleStatus === 'reconnecting' ||
    bleStatus === 'rescanning' ||
    bleStatus === 'waiting_for_telemetry'
  const statusColor =
    bleStatus === 'connected'
      ? theme.palette.green.color
      : bleStatus === 'error'
        ? theme.status.error.color
        : theme.control.textMuted

  return (
    <View ref={ref} collapsable={false} style={[styles.pill, { maxWidth }]}>
      <Pressable
        style={({ pressed }) => [styles.boardButton, pressed && styles.pressed]}
        onPress={onOpenSelector}
        testID="board-selector-trigger"
        accessibilityRole="button"
        accessibilityLabel="Board selector"
      >
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        {replay && <ReplayBadge />}
        <Text style={styles.boardText} numberOfLines={1}>
          {name ?? 'No board'}
        </Text>
        <CaretDownIcon size={12} color={theme.control.textMuted} weight="bold" />
      </Pressable>
      <BoardPillButton
        icon={PencilSimpleIcon}
        onPress={onEdit}
        label="Edit board"
        testID="board-edit-button"
      />
      {canDisconnect && (
        <BoardPillButton
          icon={PowerIcon}
          onPress={onDisconnect}
          label="Disconnect board"
          testID="board-disconnect-button"
          color={theme.status.error.color}
        />
      )}
      {onStopRecording && (
        <BoardPillButton
          icon={RecordIcon}
          onPress={onStopRecording}
          label="Debug recording active"
          testID="debug-recording-button"
          color={theme.status.warning.color}
        />
      )}
      {warning && (
        <BoardPillButton
          icon={EngineIcon}
          onPress={warning.onPress}
          anchorRef={warning.ref}
          label="Board warnings"
          testID="board-warnings-button"
          color={severityStatus(warning.severity).color}
        />
      )}
      {fault && (
        <BoardPillButton
          icon={WarningDiamondIcon}
          onPress={fault.onPress}
          anchorRef={fault.ref}
          label="VESC faults"
          testID="vesc-faults-button"
          color={theme.status.caution.color}
        />
      )}
    </View>
  )
})

function BoardPillButton({
  icon: IconComponent,
  onPress,
  anchorRef,
  label,
  testID,
  color = theme.control.text,
}: {
  icon: Icon
  onPress?: () => void
  anchorRef?: RefObject<View | null>
  label: string
  testID: string
  color?: string
}) {
  return (
    <>
      <View style={styles.divider} />
      <View ref={anchorRef} collapsable={false}>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            !onPress && styles.disabled,
            pressed && styles.pressed,
          ]}
          disabled={!onPress}
          onPress={onPress}
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ disabled: !onPress }}
        >
          <IconComponent
            size={14}
            color={onPress ? color : theme.control.textMuted}
            weight="bold"
          />
        </Pressable>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: theme.control.border,
    backgroundColor: theme.control.background,
    overflow: 'hidden',
  },
  boardButton: {
    flexDirection: 'row',
    flexShrink: 1,
    alignItems: 'center',
    gap: 6,
    paddingLeft: 10,
    paddingRight: 8,
    minHeight: 38,
    minWidth: 0,
    overflow: 'hidden',
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  boardText: {
    color: theme.control.text,
    fontSize: 13,
    fontWeight: '800',
    maxWidth: 180,
    flexShrink: 1,
  },
  divider: { width: 1, height: 20, backgroundColor: theme.control.divider },
  button: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
})
