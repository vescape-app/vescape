import { useMemo, useState } from 'react'
import { Keyboard, Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import {
  CaretDownIcon,
  CheckIcon,
  FadersIcon,
  KeyboardIcon,
  RulerIcon,
  type Icon,
} from 'phosphor-react-native'

import { IconButton } from '@/components/base/IconButton'
import { formatManualTuneValue, parseManualTuneValue } from '@/modules/tune/lib/manualTuneValue'
import { Button } from '@/components/base/Button'
import { Input } from '@/components/forms/Input'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { TuneDial } from '@/modules/tune/components/TuneDial'
import { theme, type ThemeColor } from '@/constants/theme'
import type { LinkedFieldPreview } from '@/modules/tune/lib/sliderDefinitions'
import { formatTuneValue } from '@/modules/tune/lib/fields'

export interface FieldEditorTarget {
  triggerRef: React.RefObject<View | null>
  label: string
  description?: string
  fieldId: string
  value: number
  min: number
  max: number
  step: number
  strictRange?: boolean
  manualDecimals?: number
  unit: string | null
  help: string
  icon?: Icon
  color?: ThemeColor
  linkedFields?: LinkedFieldPreview[]
}

interface FieldEditorPopoverProps {
  target: FieldEditorTarget | null
  onCancel: () => void
  onApply: (value: number, linkedFieldValues?: Record<string, number>) => void
}

export function FieldEditorPopover({ target, onCancel, onApply }: FieldEditorPopoverProps) {
  if (!target) return null

  return (
    <FieldEditorPopoverInner
      key={target.fieldId}
      target={target}
      onCancel={onCancel}
      onApply={onApply}
    />
  )
}

interface FieldEditorPopoverInnerProps {
  target: FieldEditorTarget
  onCancel: () => void
  onApply: (value: number, linkedFieldValues?: Record<string, number>) => void
}

function FieldEditorPopoverInner({ target, onCancel, onApply }: FieldEditorPopoverInnerProps) {
  const [draftValue, setDraftValue] = useState(target.value)
  const [mode, setMode] = useState<'ruler' | 'manual'>('ruler')
  const [manualText, setManualText] = useState(formatManualTuneValue(target.value))
  const manual = parseManualTuneValue(manualText, target.manualDecimals ?? 3, target.value)
  const manualError = mode === 'manual' ? manual.error : null
  const outsideRange = draftValue < target.min || draftValue > target.max
  const changeManualText = (text: string) => {
    setManualText(text)
    const parsed = parseManualTuneValue(text, target.manualDecimals ?? 3, target.value)
    if (parsed.error === null) setDraftValue(parsed.value)
  }
  const toggleMode = () => {
    if (mode === 'manual') {
      if (manual.error) return
      Keyboard.dismiss()
      setMode('ruler')
    } else {
      setManualText(formatManualTuneValue(draftValue))
      setMode('manual')
    }
  }
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const [linkedExpanded, setLinkedExpanded] = useState(false)
  const [editedLinkedFields, setEditedLinkedFields] = useState<Record<string, true>>({})
  const linkedFields = useMemo(() => target.linkedFields ?? [], [target.linkedFields])
  const [linkedDrafts, setLinkedDrafts] = useState<Record<string, string>>({})
  const computedLinkedValues = useMemo(
    () =>
      Object.fromEntries(
        linkedFields.map((field) => [
          field.id,
          draftValue === target.value
            ? (field.currentValue ?? field.computeValue(draftValue))
            : field.computeValue(draftValue),
        ]),
      ) as Record<string, number>,
    [draftValue, target.value, linkedFields],
  )
  const linkedInputValues = useMemo(
    () =>
      Object.fromEntries(
        linkedFields.map((field) => [
          field.id,
          editedLinkedFields[field.id]
            ? (linkedDrafts[field.id] ?? '')
            : formatManualTuneValue(computedLinkedValues[field.id]),
        ]),
      ) as Record<string, string>,
    [editedLinkedFields, linkedDrafts, linkedFields, computedLinkedValues],
  )

  const linkedError = linkedFields.some(
    (field) =>
      editedLinkedFields[field.id] &&
      parseManualTuneValue(linkedDrafts[field.id] ?? '', 6, field.currentValue).error != null,
  )
  const linkedOutsideRange = linkedFields.some((field) => {
    if (!editedLinkedFields[field.id]) return false
    const parsed = parseManualTuneValue(linkedDrafts[field.id] ?? '', 6, field.currentValue)
    return parsed.error == null && (parsed.value < field.min || parsed.value > field.max)
  })
  const scaleError = target.strictRange ? outsideRange : false
  const applyBlocked = [manualError, linkedError, scaleError].some(Boolean)
  const applyEditor = () => {
    if (applyBlocked) return
    Keyboard.dismiss()
    if (draftValue === target.value && Object.keys(editedLinkedFields).length === 0) {
      onCancel()
      return
    }
    const linkedValues = Object.fromEntries(
      linkedFields.flatMap((field) => {
        if (!editedLinkedFields[field.id]) return []
        const parsed = parseManualTuneValue(linkedDrafts[field.id] ?? '', 6, field.currentValue)
        if (parsed.error !== null) return []
        const value = parsed.value
        return [[field.id, value]]
      }),
    )
    onApply(draftValue, Object.keys(linkedValues).length > 0 ? linkedValues : undefined)
  }

  return (
    <EdgeDrawer
      visible
      triggerRef={target.triggerRef}
      onClose={onCancel}
      edge="bottom"
      title={target.label}
      icon={target.icon ?? FadersIcon}
      iconColor={target.color}
      autoScrollOnContentExpand
    >
      <View style={styles.content}>
        {target.description ? <Text style={styles.description}>{target.description}</Text> : null}
        <View style={styles.panel}>
          <View style={styles.detailsHeader}>
            <Text style={styles.panelTitle}>{mode === 'ruler' ? 'Ruler' : 'Manual input'}</Text>
            <IconButton
              icon={mode === 'ruler' ? KeyboardIcon : RulerIcon}
              accessibilityLabel={mode === 'ruler' ? 'Enter value manually' : 'Use ruler'}
              testID="tune-editor-mode"
              onPress={toggleMode}
              disabled={Boolean(manualError)}
            />
          </View>
          {mode === 'manual' ? (
            <View style={styles.manualContent}>
              <View style={styles.manualRow}>
                <Input
                  testID="tune-manual-value"
                  accessibilityLabel="Tune value"
                  value={manualText}
                  onChangeText={changeManualText}
                  selectTextOnFocus
                  keyboardType="numeric"
                  returnKeyType="done"
                  onSubmitEditing={() => Keyboard.dismiss()}
                  style={styles.manualInput}
                />
                {target.unit ? <Text style={styles.dataValue}>{target.unit}</Text> : null}
              </View>
              <Text style={styles.help}>
                Range: {target.min} to {target.max}
                {target.unit ? ` ${target.unit}` : ''}
              </Text>
              {manualError ? (
                <Text accessibilityLiveRegion="polite" style={styles.manualError}>
                  {manualError}
                </Text>
              ) : null}
            </View>
          ) : (
            <TuneDial
              value={draftValue}
              previousValue={target.value}
              min={target.min}
              max={target.max}
              step={target.step}
              unit={target.unit}
              color={target.color}
              displayDecimals={Math.max(
                target.manualDecimals ?? 3,
                String(draftValue).split('.')[1]?.length ?? 0,
              )}
              onValueChange={setDraftValue}
            />
          )}
          {!manualError && outsideRange ? (
            <Text accessibilityLiveRegion="polite" style={styles.rangeWarning}>
              Outside the usual range ({target.min} to {target.max}
              {target.unit ? ` ${target.unit}` : ''}). Check this value before applying.
            </Text>
          ) : null}
          <View style={styles.dialBounds}>
            <Text style={styles.dialBoundText}>{formatTuneValue(target.min)}</Text>
            <Text style={styles.dialBoundText}>{formatTuneValue(target.max)}</Text>
          </View>
        </View>

        {linkedFields.length > 0 ? (
          <Pressable
            style={styles.panel}
            accessibilityRole="button"
            accessibilityState={{ expanded: linkedExpanded }}
            onPress={() => {
              if (!linkedExpanded) setLinkedExpanded(true)
            }}
          >
            <Pressable
              style={styles.detailsHeader}
              accessibilityRole="button"
              accessibilityState={{ expanded: linkedExpanded }}
              onPress={() => setLinkedExpanded((expanded) => !expanded)}
            >
              <Text style={styles.panelTitle}>Linked fields</Text>
              <CaretDownIcon
                size={16}
                color={theme.neutral.textMuted}
                weight="bold"
                style={{ transform: [{ rotate: linkedExpanded ? '180deg' : '0deg' }] }}
              />
            </Pressable>
            {linkedExpanded ? (
              <View style={styles.linkedGrid}>
                {linkedFields.map((field, index) => (
                  <View
                    key={field.id}
                    style={[
                      styles.linkedInputCell,
                      linkedFields.length === 5 && index >= 3 && styles.linkedInputCellHalf,
                    ]}
                  >
                    <Text style={styles.linkedLabel} numberOfLines={2}>
                      {field.label}
                    </Text>
                    <Input
                      style={styles.linkedInput}
                      accessibilityLabel={`${field.label} raw value`}
                      testID={`tune-linked-${field.id}`}
                      value={linkedInputValues[field.id] ?? ''}
                      keyboardType="decimal-pad"
                      selectTextOnFocus
                      onChangeText={(text) => {
                        setEditedLinkedFields((current) => ({ ...current, [field.id]: true }))
                        setLinkedDrafts((current) => ({ ...current, [field.id]: text }))
                      }}
                    />
                    {field.unit ? (
                      <Text style={styles.linkedUnit} numberOfLines={1}>
                        {field.unit}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}
          </Pressable>
        ) : null}

        <Pressable
          style={styles.panel}
          accessibilityRole="button"
          accessibilityState={{ expanded: detailsExpanded }}
          onPress={() => {
            if (!detailsExpanded) setDetailsExpanded(true)
          }}
        >
          <Pressable
            style={styles.detailsHeader}
            accessibilityRole="button"
            accessibilityState={{ expanded: detailsExpanded }}
            onPress={() => setDetailsExpanded((expanded) => !expanded)}
          >
            <Text style={styles.panelTitle}>Setting details</Text>
            <CaretDownIcon
              size={16}
              color={theme.neutral.textMuted}
              weight="bold"
              style={{ transform: [{ rotate: detailsExpanded ? '180deg' : '0deg' }] }}
            />
          </Pressable>
          {detailsExpanded ? (
            <View style={styles.detailsContent}>
              <Text style={styles.help}>{target.help}</Text>
              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>Field</Text>
                <Text style={styles.fieldId}>{target.fieldId}</Text>
              </View>
              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>Range</Text>
                <Text style={styles.dataValue}>
                  {formatTuneValue(target.min)} to {formatTuneValue(target.max)}
                </Text>
              </View>
              {target.unit ? (
                <View style={styles.dataRow}>
                  <Text style={styles.dataLabel}>Unit</Text>
                  <Text style={styles.dataValue}>{target.unit}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </Pressable>

        <LinkedValueNotices
          scaleError={scaleError}
          linkedError={linkedError}
          linkedOutsideRange={linkedOutsideRange}
        />
        <View style={styles.actions}>
          <Button
            label="Cancel"
            variant="secondary"
            style={styles.actionButton}
            onPress={onCancel}
          />
          <Button
            label="Apply"
            icon={CheckIcon}
            accent={target.color}
            style={styles.actionButton}
            onPress={applyEditor}
            disabled={applyBlocked}
            testID="tune-editor-apply"
          />
        </View>
      </View>
    </EdgeDrawer>
  )
}

function LinkedValueNotices({
  scaleError,
  linkedError,
  linkedOutsideRange,
}: {
  scaleError: boolean
  linkedError: boolean
  linkedOutsideRange: boolean
}) {
  return (
    <>
      {scaleError ? (
        <Text style={styles.help}>
          Outside the Rings scale. Use linked raw fields for values outside the model.
        </Text>
      ) : null}
      {linkedError ? (
        <Text style={styles.help}>Enter valid linked values (up to 6 decimals).</Text>
      ) : null}
      {linkedOutsideRange ? (
        <Text style={styles.help}>
          Linked value outside the usual range. Native validation still applies before board writes.
        </Text>
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  manualContent: { gap: 10, minHeight: 105 },
  manualRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  manualInput: { flex: 1, fontSize: 28, textAlign: 'center', fontVariant: ['tabular-nums'] },
  rangeWarning: { color: theme.status.warning.text, fontSize: 13 },
  manualError: { color: theme.status.error.text, fontSize: 13 },
  content: {
    gap: 12,
  },
  panel: {
    padding: 14,
    gap: 12,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: theme.neutral.surface,
  },
  panelTitle: {
    color: theme.neutral.textMuted,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  dialBounds: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  dialBoundText: {
    color: theme.neutral.textDim,
    fontSize: 8,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    lineHeight: 9,
  },
  detailsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailsContent: {
    gap: 12,
  },
  fieldId: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  dataValue: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  dataLabel: {
    color: theme.neutral.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  description: {
    color: theme.neutral.textSecondary,
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 20,
    textAlign: 'center',
  },
  help: {
    color: theme.neutral.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  linkedGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  linkedInputCell: {
    width: '31.7%',
    minWidth: 82,
    gap: 5,
  },
  linkedInputCellHalf: {
    width: '48.8%',
  },
  linkedLabel: {
    color: theme.neutral.textMuted,
    fontSize: 9,
    fontWeight: '800',
    lineHeight: 11,
  },
  linkedInput: {
    height: 36,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  linkedUnit: {
    color: theme.neutral.textDim,
    fontSize: 8,
    fontWeight: '700',
    lineHeight: 9,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 6,
  },
  actionButton: {
    minWidth: 128,
  },
})
