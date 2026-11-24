import { useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import {
  ArrowCounterClockwiseIcon,
  LockSimpleIcon,
  MinusIcon,
  PlusIcon,
  WarningIcon,
} from 'phosphor-react-native'

import { IconButton } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { Switch } from '@/components/controls/Switch'
import { Input } from '@/components/forms/Input'
import { Select, type SelectOption } from '@/components/forms/Select'
import { theme } from '@/constants/theme'
import { useResolvedControlColors, useResolvedNeutralColors } from '@/hooks/useTheme'
import { useUserPreferences } from '@/hooks/useUserPreferences'
import {
  clampBoardConfigFieldValue,
  decimalsForField,
  formatBoardConfigFieldValue,
  formatNumericDisplay,
  getBoardConfigRebootNote,
  resolveBoardConfigEditorKind,
  stepForBoardConfigField,
} from '@/modules/board/lib/boardConfigChangeset'
import type { ResolvedBoardConfigField } from '@/modules/board/lib/refloatFieldOverlay'

export interface BoardConfigFieldEditorProps {
  field: ResolvedBoardConfigField
  value: number | boolean | string
  isModified?: boolean
  disabled?: boolean
  refloatBaseVersion?: string | null
  showDescription?: boolean
  onChange?: (fieldId: string, nextValue: number | boolean) => void
  onReset?: (fieldId: string) => void
}

export function BoardConfigFieldEditor({
  field,
  value,
  isModified = false,
  disabled = false,
  refloatBaseVersion,
  showDescription = false,
  onChange,
  onReset,
}: BoardConfigFieldEditorProps) {
  const neutral = useResolvedNeutralColors()
  const control = useResolvedControlColors()
  const { temperatureUnit } = useUserPreferences()
  const editorKind = resolveBoardConfigEditorKind(field)
  const isReadOnly = editorKind === 'readonly' || disabled
  const rebootNote = getBoardConfigRebootNote(field.id, refloatBaseVersion)
  const decimals = decimalsForField(field)
  const rawStep = stepForBoardConfigField(field)
  const numericValue = typeof value === 'number' && Number.isFinite(value) ? value : 0
  const displayValue = numericValue * field.displayScale

  const [editingText, setEditingText] = useState(false)
  const [draftText, setDraftText] = useState('')

  useEffect(() => {
    if (!editingText) return
    setDraftText(formatNumericDisplay(displayValue, decimals))
  }, [editingText, displayValue, decimals])

  const enumOptions = useMemo<SelectOption<string>[]>(
    () => field.enumNames.map((name, index) => ({ label: name, value: String(index) })),
    [field.enumNames],
  )

  const commitNumericRaw = (rawNext: number) => {
    if (!onChange || isReadOnly) return
    const clamped = clampBoardConfigFieldValue(field, rawNext)
    onChange(field.id, clamped)
  }

  const commitDraftText = () => {
    setEditingText(false)
    const parsed = Number(draftText.replace(',', '.').trim())
    if (!Number.isFinite(parsed)) return
    const rawNext = field.displayScale > 0 ? parsed / field.displayScale : parsed
    commitNumericRaw(rawNext)
  }

  const stepBy = (direction: 1 | -1) => {
    const nextRaw = numericValue + direction * rawStep
    const rounded = Number(nextRaw.toFixed(6))
    commitNumericRaw(rounded)
  }

  const canDecrement = field.hardMin == null || numericValue > field.hardMin
  const canIncrement = field.hardMax == null || numericValue < field.hardMax

  const renderControl = () => {
    if (isReadOnly) {
      return (
        <View style={styles.readonlyWrap}>
          {editorKind === 'readonly' ? (
            <LockSimpleIcon size={13} color={theme.neutral.textMuted} weight="duotone" />
          ) : null}
          <Text style={styles.readonlyValue}>
            {formatBoardConfigFieldValue(field, value, temperatureUnit)}
          </Text>
        </View>
      )
    }

    if (editorKind === 'switch') {
      const boolValue = typeof value === 'boolean' ? value : value !== 0
      return (
        <Switch
          value={boolValue}
          disabled={isReadOnly}
          accessibilityLabel={field.label}
          testID={`board-config-switch-${field.id}`}
          onValueChange={(next) => onChange?.(field.id, next)}
        />
      )
    }

    if (editorKind === 'enum') {
      const selected = String(Math.round(numericValue))
      return (
        <Select
          options={enumOptions}
          value={selected}
          style={styles.enumSelect}
          testID={`board-config-enum-${field.id}`}
          onChange={(next) => {
            const parsed = Number(next)
            if (Number.isFinite(parsed)) onChange?.(field.id, parsed)
          }}
        />
      )
    }

    const displayUnit = editorKind === 'percentage' ? '%' : field.unit

    return (
      <View
        style={[
          styles.stepper,
          { backgroundColor: control.background, borderColor: control.border },
          isReadOnly && styles.disabledControl,
        ]}
      >
        <Pressable
          style={[styles.stepperButton, (!canDecrement || isReadOnly) && styles.buttonDisabled]}
          disabled={!canDecrement || isReadOnly}
          onPress={() => stepBy(-1)}
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${field.label}`}
          testID={`board-config-dec-${field.id}`}
        >
          <MinusIcon size={14} color={control.icon} weight="bold" />
        </Pressable>

        {editingText ? (
          <View style={styles.inlineInputWrap}>
            <Input
              value={draftText}
              onChangeText={setDraftText}
              onBlur={commitDraftText}
              onSubmitEditing={commitDraftText}
              keyboardType="decimal-pad"
              autoFocus
              selectTextOnFocus
              style={styles.inlineInput}
              testID={`board-config-input-${field.id}`}
            />
          </View>
        ) : (
          <Pressable
            style={styles.valueWrap}
            disabled={isReadOnly}
            onPress={() => {
              setDraftText(formatNumericDisplay(displayValue, decimals))
              setEditingText(true)
            }}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${field.label}`}
            testID={`board-config-value-${field.id}`}
          >
            <Text style={[styles.stepperValue, { color: control.text }]}>
              {formatNumericDisplay(displayValue, decimals)}
            </Text>
            {displayUnit ? (
              <Text style={[styles.stepperUnit, { color: control.textMuted }]}>{displayUnit}</Text>
            ) : null}
          </Pressable>
        )}

        <Pressable
          style={[styles.stepperButton, (!canIncrement || isReadOnly) && styles.buttonDisabled]}
          disabled={!canIncrement || isReadOnly}
          onPress={() => stepBy(1)}
          accessibilityRole="button"
          accessibilityLabel={`Increase ${field.label}`}
          testID={`board-config-inc-${field.id}`}
        >
          <PlusIcon size={14} color={control.icon} weight="bold" />
        </Pressable>
      </View>
    )
  }

  return (
    <View
      style={[
        styles.row,
        isModified && {
          backgroundColor: neutral.surface,
        },
      ]}
      testID={`board-config-field-${field.id}`}
    >
      <View style={styles.mainRow}>
        <View style={styles.labelBlock}>
          <View style={styles.labelLine}>
            {isModified ? <View style={styles.modifiedDot} /> : null}
            <Text style={styles.label}>{field.label}</Text>
            {field.risk === 'risky' ? (
              <WarningIcon size={14} color={theme.status.warning.color} weight="duotone" />
            ) : null}
          </View>
          {showDescription && field.description ? (
            <Text style={styles.description}>{field.description}</Text>
          ) : null}
          {rebootNote && isModified ? <Text style={styles.rebootNote}>{rebootNote}</Text> : null}
        </View>

        <View style={styles.controlCluster}>
          {isModified && onReset ? (
            <IconButton
              icon={ArrowCounterClockwiseIcon}
              size="sm"
              accessibilityLabel={`Undo change to ${field.label}`}
              testID={`board-config-reset-${field.id}`}
              onPress={() => onReset(field.id)}
            />
          ) : null}
          {renderControl()}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 6,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  labelBlock: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  labelLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  modifiedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.palette.sky.color,
  },
  label: {
    color: theme.neutral.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
  },
  description: {
    color: theme.neutral.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  rebootNote: {
    color: theme.palette.sky.text,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 15,
  },
  controlCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  readonlyWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  readonlyValue: {
    color: theme.neutral.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  enumSelect: {
    minWidth: 126,
    maxWidth: 168,
    height: 36,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 38,
    overflow: 'hidden',
  },
  disabledControl: {
    opacity: 0.45,
  },
  stepperButton: {
    paddingHorizontal: 10,
    alignSelf: 'stretch',
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  valueWrap: {
    minWidth: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 5,
  },
  stepperValue: {
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  stepperUnit: {
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 12,
    textAlign: 'center',
  },
  inlineInputWrap: {
    width: 68,
  },
  inlineInput: {
    height: 34,
    paddingVertical: 0,
    paddingHorizontal: 6,
    textAlign: 'center',
    fontSize: 14,
    borderWidth: 0,
    borderRadius: 0,
  },
})
