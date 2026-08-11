// PROTOTYPE — throwaway. Variant B: six behaviour rows, advanced lives inside each one.
// No global basic/advanced switch: you drill into the thing you care about and the
// raw fields for that thing are at the bottom of its sheet.

import { useMemo, useRef, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CaretRightIcon, XIcon } from 'phosphor-react-native'
import type { RefloatConfigField } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { formatTuneValue } from '@/modules/tune/lib/fields'
import { formatSliderValue } from '@/modules/tune/lib/sliderDefinitions'
import {
  CONCERNS,
  type Concern,
  applySliderValue,
  stepIndex,
  stepLabel,
  stepLabels,
  valueForStep,
} from '@/modules/tune/components/prototype/concerns'
import type { TuneVariantProps } from '@/modules/tune/components/prototype/types'

export const VARIANT_B_NAME = 'Drill-in behaviours'

export function VariantB(props: TuneVariantProps) {
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState<Concern | null>(null)
  const groupById = useMemo(
    () => new Map(props.displayGroups.map((g) => [g.id, g])),
    [props.displayGroups],
  )

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 110 }]}
      >
        <Text style={styles.intro}>
          Pick what you want to change. Every raw value lives inside the behaviour it belongs to.
        </Text>
        {CONCERNS.map((concern) => {
          const sliders = concern.sliderIds
            .map((id) => props.basicSliders.find((s) => s.id === id))
            .filter((s) => s != null)
          const fieldCount = concern.groupIds.reduce(
            (sum, id) => sum + (groupById.get(id)?.fields.length ?? 0),
            0,
          )
          const dirtyCount = concern.groupIds.reduce(
            (sum, id) =>
              sum +
              (groupById.get(id)?.fields ?? []).filter((f) =>
                Object.prototype.hasOwnProperty.call(props.dirtyFields, f.id),
              ).length,
            0,
          )
          const summary =
            sliders.length > 0 ? sliders.map((s) => stepLabel(s)).join(' / ') : 'Advanced only'

          return (
            <Pressable key={concern.id} style={styles.row} onPress={() => setOpen(concern)}>
              <View style={[styles.rowIcon, { backgroundColor: theme.alpha(concern.color, 0.12) }]}>
                <concern.icon size={18} color={concern.color} weight="duotone" />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{concern.title}</Text>
                <Text style={styles.rowBlurb} numberOfLines={1}>
                  {concern.blurb}
                </Text>
              </View>
              <View style={styles.rowRight}>
                <Text style={[styles.rowSummary, { color: concern.color }]} numberOfLines={1}>
                  {summary}
                </Text>
                <Text style={styles.rowMeta}>
                  {fieldCount} values{dirtyCount > 0 ? ` - ${dirtyCount} edited` : ''}
                </Text>
              </View>
              <CaretRightIcon size={16} color={theme.palette.slate.textMuted} weight="bold" />
            </Pressable>
          )
        })}
      </ScrollView>

      <Modal visible={open != null} animationType="slide" onRequestClose={() => setOpen(null)}>
        {open ? (
          <ConcernSheet
            concern={open}
            fields={open.groupIds.flatMap((id) => groupById.get(id)?.fields ?? [])}
            props={props}
            onClose={() => setOpen(null)}
          />
        ) : null}
      </Modal>
    </View>
  )
}

function ConcernSheet({
  concern,
  fields,
  props,
  onClose,
}: {
  concern: Concern
  fields: RefloatConfigField[]
  props: TuneVariantProps
  onClose: () => void
}) {
  const insets = useSafeAreaInsets()
  const sliders = concern.sliderIds
    .map((id) => props.basicSliders.find((s) => s.id === id))
    .filter((s) => s != null)

  return (
    <View style={[styles.sheet, { paddingTop: insets.top + 8 }]}>
      <View style={styles.sheetHeader}>
        <concern.icon size={20} color={concern.color} weight="duotone" />
        <Text style={styles.sheetTitle}>{concern.title}</Text>
        <Pressable onPress={onClose} hitSlop={10}>
          <XIcon size={20} color={theme.palette.slate.textSecondary} weight="bold" />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={[styles.sheetBody, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={styles.sheetBlurb}>{concern.blurb}</Text>

        {sliders.map((slider) => {
          const active = stepIndex(slider)
          return (
            <View key={slider.id} style={styles.sheetSlider}>
              <View style={styles.sheetSliderHead}>
                <Text style={styles.sheetSliderLabel}>{slider.label}</Text>
                <Text style={[styles.sheetSliderValue, { color: concern.color }]}>
                  {active == null ? stepLabel(slider) : formatSliderValue(slider)}
                </Text>
              </View>
              <View style={styles.stepRow}>
                {stepLabels(slider.id).map((label, index) => (
                  <Pressable
                    key={label}
                    style={[
                      styles.stepChip,
                      active === index && {
                        borderColor: concern.color,
                        backgroundColor: theme.alpha(concern.color, 0.12),
                      },
                    ]}
                    onPress={() =>
                      applySliderValue(slider.id, valueForStep(slider, index), props.setDraftField)
                    }
                  >
                    <Text
                      style={[styles.stepChipText, active === index && { color: concern.color }]}
                      numberOfLines={1}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.sheetSliderHint}>{slider.description}</Text>
            </View>
          )
        })}

        <Text style={styles.sheetSectionTitle}>All values</Text>
        {fields.map((field) => (
          <SheetFieldRow
            key={field.id}
            field={field}
            color={concern.color}
            dirty={Object.prototype.hasOwnProperty.call(props.dirtyFields, field.id)}
            onPress={props.openFieldEditor}
            onRevert={() => props.revertField(field.id)}
          />
        ))}
      </ScrollView>
    </View>
  )
}

function SheetFieldRow({
  field,
  color,
  dirty,
  onPress,
  onRevert,
}: {
  field: RefloatConfigField
  color: string
  dirty: boolean
  onPress: TuneVariantProps['openFieldEditor']
  onRevert: () => void
}) {
  const ref = useRef<View | null>(null)
  return (
    <View ref={ref} style={styles.fieldRowWrap}>
      <Pressable style={styles.fieldRow} onPress={() => onPress(field, ref, color)}>
        <Text style={styles.fieldLabel} numberOfLines={1}>
          {field.label}
        </Text>
        {dirty ? (
          <Pressable hitSlop={8} onPress={onRevert}>
            <Text style={styles.fieldRevert}>revert</Text>
          </Pressable>
        ) : null}
        <Text style={[styles.fieldValue, dirty && { color: theme.palette.sky.text }]}>
          {formatTuneValue(field.value)}
          {field.unit ? <Text style={styles.fieldUnit}> {field.unit}</Text> : null}
        </Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 12, gap: 8 },
  intro: { color: theme.palette.slate.textMuted, fontSize: 12, paddingHorizontal: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: theme.palette.slate.surface,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { color: theme.palette.slate.textPrimary, fontSize: 14, fontWeight: '900' },
  rowBlurb: { color: theme.palette.slate.textMuted, fontSize: 11 },
  rowRight: { alignItems: 'flex-end', gap: 2, maxWidth: 130 },
  rowSummary: { fontSize: 13, fontWeight: '800' },
  rowMeta: { color: theme.palette.slate.textDim, fontSize: 10, fontWeight: '700' },
  sheet: { flex: 1, backgroundColor: theme.palette.slate.bg },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  sheetTitle: { flex: 1, color: theme.palette.slate.textPrimary, fontSize: 18, fontWeight: '900' },
  sheetBody: { paddingHorizontal: 16, gap: 12 },
  sheetBlurb: { color: theme.palette.slate.textSecondary, fontSize: 13 },
  sheetSlider: {
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: theme.palette.slate.surface,
  },
  sheetSliderHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetSliderLabel: { color: theme.palette.slate.textPrimary, fontSize: 14, fontWeight: '800' },
  sheetSliderValue: { fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  sheetSliderHint: { color: theme.palette.slate.textMuted, fontSize: 11 },
  stepRow: { flexDirection: 'row', gap: 4 },
  stepChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    backgroundColor: theme.palette.slate.surfaceDeep,
    alignItems: 'center',
  },
  stepChipText: { color: theme.palette.slate.textMuted, fontSize: 11, fontWeight: '800' },
  sheetSectionTitle: {
    color: theme.palette.slate.textMuted,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
  },
  fieldRowWrap: {
    borderBottomWidth: 1,
    borderBottomColor: theme.palette.slate.border,
  },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  fieldLabel: { flex: 1, minWidth: 0, color: theme.palette.slate.textSecondary, fontSize: 13 },
  fieldRevert: { color: theme.palette.sky.text, fontSize: 11, fontWeight: '800' },
  fieldValue: {
    color: theme.palette.slate.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  fieldUnit: { color: theme.palette.slate.textMuted, fontSize: 11 },
})
