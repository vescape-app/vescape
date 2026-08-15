import { forwardRef } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { ArrowCounterClockwiseIcon, CheckIcon } from 'phosphor-react-native'
import type { RefloatConfigField, TuneProfileFieldValue } from 'vescape-core'

import { isDisplayableFieldValue } from '@/modules/tune/lib/fieldValues'
import { formatProfileValue } from '@/modules/tune/lib/sliderDefinitions'
import { formatTuneValue } from '@/modules/tune/lib/fields'
import { TuneTileFill } from '@/modules/tune/components/TuneTileFill'
import { theme } from '@/constants/theme'

interface TuneConfigCellProps {
  field: RefloatConfigField
  savedValue: TuneProfileFieldValue | undefined
  boardValue: TuneProfileFieldValue | undefined
  profileValue: TuneProfileFieldValue | undefined
  dirty: boolean
  boardChanged: boolean
  color: string
  onPress: () => void
  onRevert: () => void
  onAcceptBoard: () => void
}

export const TuneConfigCell = forwardRef<View, TuneConfigCellProps>(function TuneConfigCell(
  {
    field,
    savedValue,
    boardValue,
    profileValue,
    dirty,
    boardChanged,
    color,
    onPress,
    onRevert,
    onAcceptBoard,
  },
  ref,
) {
  const canAcceptBoard = boardChanged && isDisplayableFieldValue(boardValue)
  const hasActions = dirty || canAcceptBoard
  const progressFraction =
    typeof field.value === 'number' &&
    Number.isFinite(field.value) &&
    field.min != null &&
    field.max != null &&
    Number.isFinite(field.min) &&
    Number.isFinite(field.max) &&
    field.max > field.min
      ? (field.value - field.min) / (field.max - field.min)
      : null

  return (
    <View ref={ref} style={styles.cellWrapper}>
      <Pressable
        style={[styles.cell, dirty && styles.cellDirty, boardChanged && styles.cellBoardChanged]}
        onPress={onPress}
      >
        <TuneTileFill fraction={progressFraction} color={color} />
        {dirty ? (
          <Pressable style={styles.cellRevertButton} onPress={onRevert}>
            <ArrowCounterClockwiseIcon size={13} color={theme.palette.sky.text} weight="bold" />
          </Pressable>
        ) : null}
        {canAcceptBoard ? (
          <Pressable
            style={[styles.cellAcceptButton, dirty && styles.cellAcceptButtonStacked]}
            onPress={onAcceptBoard}
          >
            <CheckIcon size={13} color={theme.palette.green.text} weight="bold" />
          </Pressable>
        ) : null}
        <View style={styles.cellHeaderRow}>
          <Text
            style={[styles.cellLabel, hasActions && styles.cellLabelWithAction]}
            numberOfLines={2}
          >
            {field.label}
          </Text>
        </View>
        <Text style={styles.cellValue} numberOfLines={1} adjustsFontSizeToFit selectable>
          {formatTuneValue(field.value)}
        </Text>
        {dirty && isDisplayableFieldValue(savedValue) ? (
          <Text style={[styles.cellOldValue, styles.cellTextWithActions]} numberOfLines={1}>
            was {formatTuneValue(savedValue)}
          </Text>
        ) : null}
        {boardChanged ? (
          <Text
            style={[styles.cellProfileValue, hasActions && styles.cellTextWithActions]}
            numberOfLines={1}
          >
            profile {formatProfileValue(profileValue)}
          </Text>
        ) : null}
        {canAcceptBoard ? (
          <Text style={[styles.cellBoardValue, styles.cellTextWithActions]} numberOfLines={1}>
            board {formatTuneValue(boardValue)}
          </Text>
        ) : null}
      </Pressable>
    </View>
  )
})

const styles = StyleSheet.create({
  cellWrapper: {
    flex: 1,
  },
  cell: {
    minHeight: 82,
    paddingTop: 7,
    paddingBottom: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    backgroundColor: theme.neutral.surfaceDeep,
    overflow: 'hidden',
  },
  cellDirty: {
    backgroundColor: theme.neutral.surfaceDeep,
    borderColor: theme.palette.sky.border,
  },
  cellBoardChanged: {
    backgroundColor: theme.neutral.surfaceDeep,
    borderColor: theme.palette.green.border,
  },
  cellRevertButton: {
    position: 'absolute',
    top: 7,
    right: 8,
    zIndex: 1,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.palette.sky.bg,
  },
  cellAcceptButton: {
    position: 'absolute',
    top: 7,
    right: 8,
    zIndex: 1,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.palette.green.bg,
  },
  cellAcceptButtonStacked: {
    top: 39,
  },
  cellHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  cellValue: {
    position: 'absolute',
    right: 10,
    bottom: 4,
    color: theme.neutral.textPrimary,
    fontSize: 22,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    maxWidth: '58%',
    textAlign: 'right',
  },
  cellTextWithActions: {
    paddingRight: 26,
  },
  cellOldValue: {
    color: theme.palette.sky.text,
    fontSize: 10,
    fontWeight: '800',
    marginTop: 1,
  },
  cellProfileValue: {
    color: theme.neutral.textSecondary,
    fontSize: 10,
    fontWeight: '800',
    marginTop: 1,
  },
  cellBoardValue: {
    color: theme.palette.green.text,
    fontSize: 10,
    fontWeight: '900',
    marginTop: 1,
  },
  cellLabel: {
    color: theme.neutral.textPrimary,
    fontSize: 13,
    fontWeight: '800',
    flex: 1,
    minWidth: 0,
  },
  cellLabelWithAction: {
    paddingRight: 26,
  },
})
