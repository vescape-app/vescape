import { ArrowsDownUpIcon, CaretDownIcon, CaretUpIcon } from 'phosphor-react-native'
import { Pressable, StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { Stepper } from '@/components/forms/Stepper'
import { CollapsibleWidget } from '@/components/widgets/CollapsibleWidget'
import { theme } from '@/constants/theme'
import {
  BOARD_MOVE_STRENGTH_MAX_PERCENT,
  BOARD_MOVE_STRENGTH_MIN_PERCENT,
  BOARD_MOVE_STRENGTH_STEP_PERCENT,
  useBoardMoveControl,
} from '@/modules/board/hooks/useBoardMoveControl'

interface BoardMoveControlProps {
  collapsible?: boolean
  defaultExpanded?: boolean
}

/**
 * Board Move: hold a direction to roll the board while it is disengaged. Opening
 * the row also exposes the move strength, because how much push is enough
 * depends on the board's own remote limits.
 */
export function BoardMoveControl({
  collapsible = true,
  defaultExpanded = false,
}: BoardMoveControlProps) {
  const {
    boardConnected,
    canCommand,
    strengthPercent,
    setStrengthPercent,
    moveForward,
    moveBackward,
    stopMove,
  } = useBoardMoveControl()

  return (
    <CollapsibleWidget
      icon={ArrowsDownUpIcon}
      title="Move"
      description="Hold to roll the board while you are off it."
      accent={theme.palette.cyan.color}
      collapsible={collapsible}
      defaultExpanded={defaultExpanded}
      expandedHeight={190}
      surface={false}
    >
      <View style={styles.buttons}>
        <MoveButton
          icon={CaretDownIcon}
          label="Move board backward"
          disabled={!canCommand}
          onPressIn={moveBackward}
          onPressOut={stopMove}
        />
        <MoveButton
          icon={CaretUpIcon}
          label="Move board forward"
          disabled={!canCommand}
          onPressIn={moveForward}
          onPressOut={stopMove}
        />
      </View>

      <View style={styles.strengthRow}>
        <View style={styles.strengthText}>
          <Text style={styles.strengthLabel}>Strength</Text>
          <Text style={styles.strengthHint}>Board still caps this with its own remote limits.</Text>
        </View>
        <Stepper
          value={strengthPercent}
          unit="%"
          min={BOARD_MOVE_STRENGTH_MIN_PERCENT}
          max={BOARD_MOVE_STRENGTH_MAX_PERCENT}
          step={BOARD_MOVE_STRENGTH_STEP_PERCENT}
          onChange={setStrengthPercent}
        />
      </View>

      {!canCommand ? (
        <Text style={styles.disabledNote}>
          {boardConnected ? 'Trusted board link required.' : 'Connect board to move it.'}
        </Text>
      ) : null}
    </CollapsibleWidget>
  )
}

function MoveButton({
  icon: Icon,
  label,
  disabled,
  onPressIn,
  onPressOut,
}: {
  icon: typeof CaretUpIcon
  label: string
  disabled: boolean
  onPressIn: () => void
  onPressOut: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      <Icon size={26} color={theme.palette.cyan.color} weight="bold" />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  buttons: {
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    flex: 1,
    height: 74,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.palette.cyan.border,
    backgroundColor: theme.control.background,
  },
  buttonPressed: {
    backgroundColor: theme.palette.cyan.bg,
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  strengthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
  },
  strengthText: {
    flex: 1,
    minWidth: 0,
  },
  strengthLabel: {
    color: theme.neutral.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  strengthHint: {
    color: theme.neutral.textMuted,
    fontSize: 12,
  },
  disabledNote: {
    marginTop: 10,
    color: theme.neutral.textMuted,
    fontSize: 12,
  },
})
