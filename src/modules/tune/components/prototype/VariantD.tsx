// PROTOTYPE — throwaway. Variant D: preset first, everything else is a delta from it.
// A newbie picks a riding style and stops. A tweaker nudges with +/- steppers and always
// sees how far they drifted from the preset. Raw table stays at the bottom, unabridged.

import { useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CaretDownIcon, MinusIcon, PlusIcon } from 'phosphor-react-native'
import type { RefloatConfigField } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { formatTuneValue } from '@/modules/tune/lib/fields'
import { clamp, formatSliderValue } from '@/modules/tune/lib/sliderDefinitions'
import {
  CONCERN_BY_GROUP_ID,
  SLIDER_ICON,
  applySliderValue,
} from '@/modules/tune/components/prototype/concerns'
import type { TuneVariantProps } from '@/modules/tune/components/prototype/types'

export const VARIANT_D_NAME = 'Preset + deltas'

interface Preset {
  id: string
  name: string
  blurb: string
  color: string
  values: Record<string, number>
}

const PRESETS: Preset[] = [
  {
    id: 'chill',
    name: 'Chill',
    blurb: 'Soft, forgiving, cruises. Good first ride.',
    color: theme.palette.teal.color,
    values: {
      aggressiveness: 0,
      noseStiffness: 3,
      tailStiffness: 3,
      carveTilt: 3,
      brakeTilt: 1,
      atrIntensity: 4,
    },
  },
  {
    id: 'street',
    name: 'Street',
    blurb: 'Neutral all-rounder for pavement and paths.',
    color: theme.palette.sky.color,
    values: {
      aggressiveness: 4,
      noseStiffness: 5,
      tailStiffness: 5,
      carveTilt: 6,
      brakeTilt: 2,
      atrIntensity: 7,
    },
  },
  {
    id: 'trail',
    name: 'Trail',
    blurb: 'Climbs and loose ground, strong hill assist.',
    color: theme.palette.green.color,
    values: {
      aggressiveness: 5,
      noseStiffness: 7,
      tailStiffness: 7,
      carveTilt: 5,
      brakeTilt: 3,
      atrIntensity: 12,
    },
  },
  {
    id: 'race',
    name: 'Race',
    blurb: 'Stiff and immediate. Punishes mistakes.',
    color: theme.palette.orange.color,
    values: {
      aggressiveness: 9,
      noseStiffness: 8,
      tailStiffness: 8,
      carveTilt: 9,
      brakeTilt: 4,
      atrIntensity: 9,
    },
  },
]

export function VariantD(props: TuneVariantProps) {
  const insets = useSafeAreaInsets()
  const [rawOpen, setRawOpen] = useState(false)

  const matched = useMemo(() => {
    return (
      PRESETS.find((preset) =>
        props.basicSliders.every((slider) => {
          const target = preset.values[slider.id]
          return target == null || (slider.value != null && Math.abs(slider.value - target) < 0.51)
        }),
      ) ?? null
    )
  }, [props.basicSliders])

  const [baseId, setBaseId] = useState<string | null>(null)
  const base = PRESETS.find((p) => p.id === (matched?.id ?? baseId)) ?? null

  const applyPreset = (preset: Preset) => {
    setBaseId(preset.id)
    for (const [sliderId, value] of Object.entries(preset.values)) {
      applySliderValue(sliderId, value, props.setDraftField)
    }
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 110 }]}
    >
      <Text style={styles.sectionTitle}>Start from a style</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.presetRow}
      >
        {PRESETS.map((preset) => {
          const active = base?.id === preset.id
          return (
            <Pressable
              key={preset.id}
              style={[
                styles.presetCard,
                active && {
                  borderColor: preset.color,
                  backgroundColor: theme.alpha(preset.color, 0.12),
                },
              ]}
              onPress={() => applyPreset(preset)}
            >
              <Text style={[styles.presetName, active && { color: preset.color }]}>
                {preset.name}
              </Text>
              <Text style={styles.presetBlurb}>{preset.blurb}</Text>
              {active ? (
                <Text style={[styles.presetState, { color: preset.color }]}>
                  {matched ? 'exact match' : 'base'}
                </Text>
              ) : null}
            </Pressable>
          )
        })}
      </ScrollView>

      <View style={styles.statusCard}>
        <Text style={styles.statusText}>
          {matched
            ? `Your tune is exactly ${matched.name}.`
            : base
              ? `Custom, based on ${base.name}.`
              : 'Custom tune. Pick a style above to get a reference point.'}
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Adjustments</Text>
      {props.basicSliders.map((slider) => {
        const Icon = SLIDER_ICON[slider.id]
        const baseValue = base?.values[slider.id]
        const delta =
          baseValue != null && slider.value != null ? Math.round(slider.value - baseValue) : null
        const nudge = (direction: 1 | -1) => {
          const next = clamp(
            (slider.value ?? slider.min) + direction * slider.step,
            slider.min,
            slider.max,
          )
          applySliderValue(slider.id, next, props.setDraftField)
        }
        return (
          <View key={slider.id} style={styles.adjustRow}>
            {Icon ? <Icon size={16} color={theme.tune.color} weight="duotone" /> : null}
            <View style={styles.adjustText}>
              <Text style={styles.adjustLabel}>{slider.label}</Text>
              <Text style={styles.adjustHint} numberOfLines={1}>
                {slider.description}
              </Text>
            </View>
            {delta != null && delta !== 0 ? (
              <Text style={styles.delta}>
                {delta > 0 ? '+' : ''}
                {delta}
              </Text>
            ) : null}
            <Pressable style={styles.stepper} hitSlop={6} onPress={() => nudge(-1)}>
              <MinusIcon size={14} color={theme.palette.slate.textSecondary} weight="bold" />
            </Pressable>
            <Text style={styles.adjustValue}>{formatSliderValue(slider)}</Text>
            <Pressable style={styles.stepper} hitSlop={6} onPress={() => nudge(1)}>
              <PlusIcon size={14} color={theme.palette.slate.textSecondary} weight="bold" />
            </Pressable>
          </View>
        )
      })}

      <Pressable style={styles.rawToggle} onPress={() => setRawOpen((open) => !open)}>
        <Text style={styles.rawToggleText}>All values</Text>
        <CaretDownIcon
          size={14}
          color={theme.palette.slate.textMuted}
          weight="bold"
          style={{ transform: [{ rotate: rawOpen ? '180deg' : '0deg' }] }}
        />
      </Pressable>

      {rawOpen
        ? props.displayGroups.map((group) => {
            const color = CONCERN_BY_GROUP_ID.get(group.id)?.color ?? theme.palette.sky.color
            return (
              <View key={group.id} style={styles.rawGroup}>
                <Text style={[styles.rawGroupTitle, { color }]}>{group.title}</Text>
                {group.fields.map((field) => (
                  <TableRow
                    key={field.id}
                    field={field}
                    color={color}
                    dirty={Object.prototype.hasOwnProperty.call(props.dirtyFields, field.id)}
                    onPress={props.openFieldEditor}
                  />
                ))}
              </View>
            )
          })
        : null}
    </ScrollView>
  )
}

function TableRow({
  field,
  color,
  dirty,
  onPress,
}: {
  field: RefloatConfigField
  color: string
  dirty: boolean
  onPress: TuneVariantProps['openFieldEditor']
}) {
  const ref = useRef<View | null>(null)
  return (
    <View ref={ref}>
      <Pressable style={styles.tableRow} onPress={() => onPress(field, ref, color)}>
        <Text style={styles.tableLabel} numberOfLines={1}>
          {field.label}
        </Text>
        <Text style={[styles.tableValue, dirty && { color: theme.palette.sky.text }]}>
          {formatTuneValue(field.value)}
          {field.unit ? <Text style={styles.tableUnit}> {field.unit}</Text> : null}
        </Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 12, gap: 8 },
  sectionTitle: {
    color: theme.palette.slate.textMuted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingTop: 6,
  },
  presetRow: { gap: 8, paddingRight: 12 },
  presetCard: {
    width: 158,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    backgroundColor: theme.palette.slate.surface,
    gap: 4,
  },
  presetName: { color: theme.palette.slate.textPrimary, fontSize: 15, fontWeight: '900' },
  presetBlurb: { color: theme.palette.slate.textMuted, fontSize: 11 },
  presetState: { fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  statusCard: {
    padding: 10,
    borderRadius: 10,
    backgroundColor: theme.palette.slate.surfaceDeep,
  },
  statusText: { color: theme.palette.slate.textSecondary, fontSize: 12, fontWeight: '700' },
  adjustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: theme.palette.slate.surface,
  },
  adjustText: { flex: 1, minWidth: 0 },
  adjustLabel: { color: theme.palette.slate.textPrimary, fontSize: 13, fontWeight: '800' },
  adjustHint: { color: theme.palette.slate.textMuted, fontSize: 10 },
  delta: {
    color: theme.palette.amber.text,
    fontSize: 11,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  stepper: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.palette.slate.surfaceDeep,
  },
  adjustValue: {
    color: theme.palette.slate.textPrimary,
    fontSize: 15,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    minWidth: 26,
    textAlign: 'center',
  },
  rawToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    marginTop: 4,
  },
  rawToggleText: { color: theme.palette.slate.textSecondary, fontSize: 12, fontWeight: '800' },
  rawGroup: { paddingBottom: 8 },
  rawGroupTitle: {
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingVertical: 6,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.palette.slate.border,
  },
  tableLabel: { flex: 1, minWidth: 0, color: theme.palette.slate.textSecondary, fontSize: 12 },
  tableValue: {
    color: theme.palette.slate.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  tableUnit: { color: theme.palette.slate.textMuted, fontSize: 10 },
})
