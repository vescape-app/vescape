// PROTOTYPE — throwaway. Variant A: one depth ladder, same concerns at every depth.
// Basic/advanced is not a separate screen: raising depth adds detail to the same rows.

import { useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { RefloatConfigField } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { formatTuneValue } from '@/modules/tune/lib/fields'
import { formatSliderValue } from '@/modules/tune/lib/sliderDefinitions'
import {
  CONCERNS,
  applySliderValue,
  stepIndex,
  stepLabel,
  stepLabels,
  valueForStep,
} from '@/modules/tune/components/prototype/concerns'
import type { TuneVariantProps } from '@/modules/tune/components/prototype/types'

export const VARIANT_A_NAME = 'Depth ladder'

type Depth = 0 | 1 | 2
const DEPTHS: { id: Depth; label: string; hint: string }[] = [
  { id: 0, label: 'Ride', hint: 'Words only. Nothing to break.' },
  { id: 1, label: 'Tune', hint: 'Numbers on the six controls that matter.' },
  { id: 2, label: 'Expert', hint: 'Every raw field, in context.' },
]

export function VariantA(props: TuneVariantProps) {
  const insets = useSafeAreaInsets()
  const [depth, setDepth] = useState<Depth>(0)
  const groupById = new Map(props.displayGroups.map((g) => [g.id, g]))

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 110 }]}
    >
      <View style={styles.depthBar}>
        {DEPTHS.map((item) => (
          <Pressable
            key={item.id}
            style={[styles.depthTab, depth === item.id && styles.depthTabActive]}
            onPress={() => setDepth(item.id)}
          >
            <Text style={[styles.depthLabel, depth === item.id && styles.depthLabelActive]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.depthHint}>{DEPTHS[depth].hint}</Text>

      {CONCERNS.map((concern) => {
        const sliders = concern.sliderIds
          .map((id) => props.basicSliders.find((s) => s.id === id))
          .filter((s) => s != null)
        const fields = concern.groupIds.flatMap((id) => groupById.get(id)?.fields ?? [])
        if (sliders.length === 0 && depth < 2) return null

        return (
          <View key={concern.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <concern.icon size={17} color={concern.color} weight="duotone" />
              <Text style={styles.cardTitle}>{concern.title}</Text>
            </View>
            {depth === 0 ? <Text style={styles.cardBlurb}>{concern.blurb}</Text> : null}

            {sliders.map((slider) => {
              const active = stepIndex(slider)
              return (
                <View key={slider.id} style={styles.sliderBlock}>
                  {sliders.length > 1 || depth > 0 ? (
                    <View style={styles.sliderHeadRow}>
                      <Text style={styles.sliderLabel}>{slider.label}</Text>
                      {depth > 0 ? (
                        <Text style={[styles.sliderNumber, { color: concern.color }]}>
                          {formatSliderValue(slider)}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                  <View style={styles.stepRow}>
                    {stepLabels(slider.id).map((label, index) => (
                      <Pressable
                        key={label}
                        style={[
                          styles.stepChip,
                          active === index && { borderColor: concern.color },
                          active === index && styles.stepChipActive,
                        ]}
                        onPress={() =>
                          applySliderValue(
                            slider.id,
                            valueForStep(slider, index),
                            props.setDraftField,
                          )
                        }
                      >
                        <Text
                          style={[
                            styles.stepChipText,
                            active === index && { color: concern.color },
                          ]}
                          numberOfLines={1}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {active == null ? (
                    <Pressable
                      style={styles.customRow}
                      onPress={() => props.resetSliderFormula(slider.id)}
                    >
                      <Text style={styles.customText}>
                        {stepLabel(slider)} - hand-edited values, tap to snap back to a preset step
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              )
            })}

            {depth === 2 && fields.length > 0 ? (
              <View style={styles.rawBlock}>
                {fields.map((field) => (
                  <RawRow
                    key={field.id}
                    field={field}
                    dirty={Object.prototype.hasOwnProperty.call(props.dirtyFields, field.id)}
                    color={concern.color}
                    onPress={props.openFieldEditor}
                  />
                ))}
              </View>
            ) : null}
          </View>
        )
      })}

      {depth < 2 ? (
        <Pressable style={styles.deeper} onPress={() => setDepth((depth + 1) as Depth)}>
          <Text style={styles.deeperText}>Go deeper: {DEPTHS[depth + 1].label}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  )
}

function RawRow({
  field,
  dirty,
  color,
  onPress,
}: {
  field: RefloatConfigField
  dirty: boolean
  color: string
  onPress: TuneVariantProps['openFieldEditor']
}) {
  const ref = useRef<View | null>(null)
  return (
    <View ref={ref}>
      <Pressable style={styles.rawRow} onPress={() => onPress(field, ref, color)}>
        <Text style={styles.rawLabel} numberOfLines={1}>
          {field.label}
        </Text>
        <Text style={[styles.rawValue, dirty && { color: theme.palette.sky.text }]}>
          {formatTuneValue(field.value)}
          {field.unit ? <Text style={styles.rawUnit}> {field.unit}</Text> : null}
        </Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 12, gap: 10 },
  depthBar: {
    flexDirection: 'row',
    backgroundColor: theme.palette.slate.surfaceDeep,
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  depthTab: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  depthTabActive: { backgroundColor: theme.palette.slate.surface },
  depthLabel: { color: theme.palette.slate.textMuted, fontSize: 13, fontWeight: '800' },
  depthLabelActive: { color: theme.palette.slate.textPrimary },
  depthHint: {
    color: theme.palette.slate.textMuted,
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 4,
    marginTop: -4,
  },
  card: {
    backgroundColor: theme.palette.slate.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    padding: 12,
    gap: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  cardTitle: { color: theme.palette.slate.textPrimary, fontSize: 15, fontWeight: '900' },
  cardBlurb: { color: theme.palette.slate.textSecondary, fontSize: 12, marginTop: -6 },
  sliderBlock: { gap: 6 },
  sliderHeadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sliderLabel: { color: theme.palette.slate.textSecondary, fontSize: 12, fontWeight: '800' },
  sliderNumber: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  stepRow: { flexDirection: 'row', gap: 4 },
  stepChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    backgroundColor: theme.palette.slate.surfaceDeep,
    alignItems: 'center',
  },
  stepChipActive: { backgroundColor: theme.palette.slate.bg },
  stepChipText: { color: theme.palette.slate.textMuted, fontSize: 11, fontWeight: '800' },
  customRow: {
    borderRadius: 8,
    backgroundColor: theme.palette.yellow.bg,
    borderWidth: 1,
    borderColor: theme.palette.yellow.border,
    padding: 8,
  },
  customText: { color: theme.palette.yellow.text, fontSize: 11, fontWeight: '700' },
  rawBlock: {
    borderTopWidth: 1,
    borderTopColor: theme.palette.slate.border,
    paddingTop: 4,
  },
  rawRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    gap: 12,
  },
  rawLabel: { color: theme.palette.slate.textSecondary, fontSize: 12, flex: 1, minWidth: 0 },
  rawValue: {
    color: theme.palette.slate.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  rawUnit: { color: theme.palette.slate.textMuted, fontSize: 11, fontWeight: '700' },
  deeper: {
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
  },
  deeperText: { color: theme.palette.slate.textSecondary, fontSize: 12, fontWeight: '800' },
})
