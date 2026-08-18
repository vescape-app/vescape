import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { CaretDownIcon, CheckIcon, FadersIcon, type Icon } from 'phosphor-react-native'

import { Button } from '@/components/base/Button'
import { Input } from '@/components/forms/Input'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { TuneDial } from '@/modules/tune/components/TuneDial'
import { theme } from '@/constants/theme'
import { snapValue } from '@/modules/tune/lib/sliderDefinitions'
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
  unit: string | null
  help: string
  icon?: Icon
  color?: string
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
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const [linkedExpanded, setLinkedExpanded] = useState(false)
  const [editedLinkedFields, setEditedLinkedFields] = useState<Record<string, true>>({})
  const linkedFields = useMemo(() => target.linkedFields ?? [], [target.linkedFields])
  const [linkedDrafts, setLinkedDrafts] = useState<Record<string, string>>({})
  const linkedInputValues = useMemo(
    () =>
      Object.fromEntries(
        linkedFields.map((field) => [
          field.id,
          editedLinkedFields[field.id]
            ? (linkedDrafts[field.id] ?? '')
            : formatTuneValue(field.computeValue(draftValue)),
        ]),
      ) as Record<string, string>,
    [draftValue, editedLinkedFields, linkedDrafts, linkedFields],
  )
  const computedLinkedValues = useMemo(
    () =>
      Object.fromEntries(
        linkedFields.map((field) => [field.id, field.computeValue(draftValue)]),
      ) as Record<string, number>,
    [draftValue, linkedFields],
  )

  const applyEditor = () => {
    const snappedValue = snapValue(draftValue, target.min, target.max, target.step)
    const linkedValues = Object.fromEntries(
      linkedFields.flatMap((field) => {
        if (!editedLinkedFields[field.id]) return []
        const parsed = Number.parseFloat(linkedDrafts[field.id] ?? '')
        const value = Number.isFinite(parsed)
          ? snapValue(parsed, field.min, field.max, field.step)
          : computedLinkedValues[field.id]
        return [[field.id, value]]
      }),
    )
    onApply(snappedValue, Object.keys(linkedValues).length > 0 ? linkedValues : undefined)
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
          <TuneDial
            value={draftValue}
            previousValue={target.value}
            min={target.min}
            max={target.max}
            step={target.step}
            unit={target.unit}
            color={target.color}
            onValueChange={setDraftValue}
          />
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
                color={theme.palette.slate.textMuted}
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
                      value={linkedInputValues[field.id] ?? ''}
                      keyboardType="decimal-pad"
                      selectTextOnFocus
                      onChangeText={(text) => {
                        setEditedLinkedFields((current) => ({ ...current, [field.id]: true }))
                        setLinkedDrafts((current) => ({ ...current, [field.id]: text }))
                      }}
                      onBlur={() => {
                        const parsed = Number.parseFloat(linkedInputValues[field.id] ?? '')
                        const value = Number.isFinite(parsed)
                          ? snapValue(parsed, field.min, field.max, field.step)
                          : computedLinkedValues[field.id]
                        setLinkedDrafts((current) => ({
                          ...current,
                          [field.id]: formatTuneValue(value),
                        }))
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
              color={theme.palette.slate.textMuted}
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
            style={styles.actionButton}
            onPress={applyEditor}
          />
        </View>
      </View>
    </EdgeDrawer>
  )
}

const styles = StyleSheet.create({
  content: {
    gap: 12,
  },
  panel: {
    padding: 14,
    gap: 12,
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    backgroundColor: theme.palette.slate.surface,
  },
  panelTitle: {
    color: theme.palette.slate.textMuted,
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
    color: theme.palette.slate.textDim,
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
    color: theme.palette.slate.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  dataValue: {
    color: theme.palette.slate.textSecondary,
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
    color: theme.palette.slate.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  description: {
    color: theme.palette.slate.textSecondary,
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 20,
    textAlign: 'center',
  },
  help: {
    color: theme.palette.slate.textMuted,
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
    color: theme.palette.slate.textMuted,
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
    color: theme.palette.slate.textDim,
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
