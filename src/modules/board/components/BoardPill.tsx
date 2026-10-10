import { forwardRef, type RefObject } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import {
  EngineIcon,
  PowerIcon,
  RecordIcon,
  WarningDiamondIcon,
  type Icon,
} from 'phosphor-react-native'
import type { BoardWarningSeverity } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { ReplayBadge } from '@/modules/board/components/ReplayBadge'
import { severityStatus } from '@/modules/board/constants/boardWarnings'
import { theme, type ThemeColor } from '@/constants/theme'

interface PillAction {
  onPress: () => void
  ref?: RefObject<View | null>
}

/**
 * A live Accessory link, handed in already resolved.
 *
 * The icon and the label arrive as props because the pill belongs to the Board domain and must not
 * learn what an Accessory is — the same seam the Board selector uses for its Accessories section.
 */
export interface BoardPillAccessory {
  icon: Icon
  label: string
  onPress: () => void
}

interface BoardPillProps {
  maxWidth: number
  name: string | null
  bleStatus: string
  replay?: boolean
  onOpenSelector: () => void
  onDisconnect: () => void
  /** Starts a connection while the board is idle; absent when there is no board to reach. */
  onConnect?: () => void
  onStopRecording?: () => void
  warning?: PillAction & { severity: BoardWarningSeverity }
  fault?: PillAction
  /** Present only while at least one Accessory is actually connected. */
  accessory?: BoardPillAccessory
}

/** Shared presentation for the live board bar and its state-controlled design preview. */
export const BoardPill = forwardRef<View, BoardPillProps>(function BoardPill(
  {
    maxWidth,
    name,
    bleStatus,
    replay,
    onOpenSelector,
    onDisconnect,
    onConnect,
    onStopRecording,
    warning,
    fault,
    accessory,
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
      {/* Leads the pill, green, only while a link is up: a rider glancing down sees that the
          hardware is talking without opening anything. */}
      {accessory && (
        <BoardPillButton
          icon={accessory.icon}
          onPress={accessory.onPress}
          label={accessory.label}
          testID="board-accessory-button"
          color={theme.status.success.color}
          dividerSide="after"
        />
      )}
      <Pressable
        style={({ pressed }) => [styles.boardButton, pressed && styles.pressed]}
        onPress={onOpenSelector}
        testID="board-selector-trigger"
        accessibilityRole="button"
        accessibilityLabel={`${name ?? 'No board'}, board selector`}
      >
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        {replay && <ReplayBadge />}
        <Text style={styles.boardText} numberOfLines={1}>
          {name ?? 'No board'}
        </Text>
      </Pressable>
      {/* One power key: red while there is a link to cut, quiet gray while there is one to open. */}
      {canDisconnect ? (
        <BoardPillButton
          icon={PowerIcon}
          onPress={onDisconnect}
          label="Disconnect board"
          testID="board-disconnect-button"
          color={theme.status.error.color}
        />
      ) : onConnect ? (
        <BoardPillButton
          icon={PowerIcon}
          onPress={onConnect}
          label="Connect board"
          testID="board-connect-button"
          color={theme.control.textMuted}
        />
      ) : null}
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
  dividerSide = 'before',
}: {
  icon: Icon
  onPress?: () => void
  anchorRef?: RefObject<View | null>
  label: string
  testID: string
  color?: ThemeColor
  /** Which edge the separator sits on, so a leading button is cut off from the name, not the air. */
  dividerSide?: 'before' | 'after'
}) {
  const divider = <View style={styles.divider} />
  return (
    <>
      {dividerSide === 'before' && divider}
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
      {dividerSide === 'after' && divider}
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
    paddingHorizontal: 12,
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
  // Runs the pill's full height rather than floating in the middle of it — same rule as the
  // board selector's links strip and the settings status strip.
  divider: {
    width: StyleSheet.hairlineWidth * 2,
    alignSelf: 'stretch',
    backgroundColor: theme.control.divider,
  },
  button: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
})
