// PROTOTYPE — throwaway. Variant E: three workspaces instead of one long scroll.
// Feel = what the board does (words + segment gauges). Values = the whole raw table.
// Changes = every pending edit and board difference in one reviewable place.

import { useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowCounterClockwiseIcon, CheckIcon } from 'phosphor-react-native'
import type { RefloatConfigField } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { formatTuneValue } from '@/modules/tune/lib/fields'
import { formatSliderValue, type BasicSliderItem } from '@/modules/tune/lib/sliderDefinitions'
import {
  CONCERN_BY_GROUP_ID,
  SLIDER_ICON,
  STEP_COUNT,
  stepIndex,
  stepLabel,
} from '@/modules/tune/components/prototype/concerns'
import type { TuneVariantProps } from '@/modules/tune/components/prototype/types'

export const VARIANT_E_NAME = 'Feel / Values / Changes'

type Tab = 'feel' | 'values' | 'changes'

export function VariantE(props: TuneVariantProps) {
  const insets = useSafeAreaInsets()
  const [tab, setTab] = useState<Tab>('feel')

  const changes = useMemo(() => {
    const edited = props.displayGroups.flatMap((group) =>
      group.fields.filter((field) =>
        Object.prototype.hasOwnProperty.call(props.dirtyFields, field.id),
      ),
    )
    const boardDiffs = props.displayGroups.flatMap((group) =>
      group.fields.filter((field) => props.boardDiffByField.has(field.id)),
    )
    return { edited, boardDiffs }
  }, [props.boardDiffByField, props.dirtyFields, props.displayGroups])

  const changeCount = changes.edited.length + changes.boardDiffs.length

  return (
    <View style={styles.root}>
      <View style={styles.tabBar}>
        {(
          [
            ['feel', 'Feel'],
            ['values', `Values (${props.displayGroups.reduce((n, g) => n + g.fields.length, 0)})`],
            ['changes', `Changes${changeCount > 0 ? ` (${changeCount})` : ''}`],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <Pressable
            key={id}
            style={[styles.tab, tab === id && styles.tabActive]}
            onPress={() => setTab(id)}
          >
            <Text style={[styles.tabText, tab === id && styles.tabTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 110 }]}
      >
        {tab === 'feel' ? (
          <View style={styles.gaugeGrid}>
            {props.basicSliders.map((slider) => (
              <GaugeCard
                key={slider.id}
                slider={slider}
                onPress={props.openBasicSliderEditor}
                onResetFormula={() => props.resetSliderFormula(slider.id)}
              />
            ))}
          </View>
        ) : null}

        {tab === 'values'
          ? props.displayGroups.map((group) => {
              const color = CONCERN_BY_GROUP_ID.get(group.id)?.color ?? theme.palette.sky.color
              return (
                <View key={group.id} style={styles.group}>
                  <Text style={[styles.groupTitle, { color }]}>
                    {CONCERN_BY_GROUP_ID.get(group.id)?.title ?? group.title}
                  </Text>
                  {group.fields.map((field) => (
                    <DenseRow
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

        {tab === 'changes' ? (
          <View style={styles.group}>
            {changeCount === 0 ? (
              <Text style={styles.empty}>Nothing pending. Profile matches the board.</Text>
            ) : null}
            {changes.edited.length > 0 ? (
              <Text style={[styles.groupTitle, { color: theme.palette.sky.color }]}>
                Your unsaved edits
              </Text>
            ) : null}
            {changes.edited.map((field) => (
              <ChangeRow
                key={field.id}
                field={field}
                right={formatTuneValue(field.value)}
                rightColor={theme.palette.sky.text}
                actionIcon="revert"
                onAction={() => props.revertField(field.id)}
              />
            ))}
            {changes.boardDiffs.length > 0 ? (
              <Text style={[styles.groupTitle, { color: theme.palette.green.color }]}>
                Board differs from profile
              </Text>
            ) : null}
            {changes.boardDiffs.map((field) => {
              const diff = props.boardDiffByField.get(field.id)
              return (
                <ChangeRow
                  key={field.id}
                  field={field}
                  right={`board ${formatTuneValue((diff?.boardValue ?? field.value) as number | string | boolean)}`}
                  rightColor={theme.palette.green.text}
                  actionIcon="accept"
                  onAction={() => props.acceptBoardField(field.id)}
                />
              )
            })}
          </View>
        ) : null}
      </ScrollView>
    </View>
  )
}

function GaugeCard({
  slider,
  onPress,
  onResetFormula,
}: {
  slider: BasicSliderItem
  onPress: TuneVariantProps['openBasicSliderEditor']
  onResetFormula: () => void
}) {
  const ref = useRef<View | null>(null)
  const Icon = SLIDER_ICON[slider.id]
  const index = stepIndex(slider)
  const color = index == null ? theme.palette.yellow.color : theme.tune.color

  return (
    <View ref={ref} style={styles.gaugeWrap}>
      <Pressable style={styles.gauge} onPress={() => onPress(slider.id, ref)}>
        <View style={styles.gaugeHead}>
          {Icon ? <Icon size={15} color={color} weight="duotone" /> : null}
          <Text style={styles.gaugeLabel} numberOfLines={1}>
            {slider.label}
          </Text>
        </View>
        <Text style={[styles.gaugeWord, { color }]} numberOfLines={1}>
          {stepLabel(slider)}
        </Text>
        <View style={styles.segments}>
          {Array.from({ length: STEP_COUNT }, (_, i) => (
            <View
              key={i}
              style={[
                styles.segment,
                index != null && i <= index && { backgroundColor: color },
                index == null && { backgroundColor: theme.alpha(color, 0.3) },
              ]}
            />
          ))}
        </View>
        <View style={styles.gaugeFoot}>
          <Text style={styles.gaugeNumber}>{formatSliderValue(slider)}</Text>
          {index == null ? (
            <Pressable hitSlop={8} onPress={onResetFormula}>
              <Text style={styles.gaugeResnap}>resnap</Text>
            </Pressable>
          ) : null}
        </View>
      </Pressable>
    </View>
  )
}

function DenseRow({
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
      <Pressable style={styles.denseRow} onPress={() => onPress(field, ref, color)}>
        <Text style={styles.denseLabel} numberOfLines={1}>
          {field.label}
        </Text>
        <Text style={styles.denseId} numberOfLines={1}>
          {field.id}
        </Text>
        <Text style={[styles.denseValue, dirty && { color: theme.palette.sky.text }]}>
          {formatTuneValue(field.value)}
        </Text>
      </Pressable>
    </View>
  )
}

function ChangeRow({
  field,
  right,
  rightColor,
  actionIcon,
  onAction,
}: {
  field: RefloatConfigField
  right: string
  rightColor: string
  actionIcon: 'revert' | 'accept'
  onAction: () => void
}) {
  return (
    <View style={styles.changeRow}>
      <View style={styles.changeText}>
        <Text style={styles.denseLabel} numberOfLines={1}>
          {field.label}
        </Text>
        <Text style={[styles.changeValue, { color: rightColor }]}>{right}</Text>
      </View>
      <Pressable style={styles.changeAction} hitSlop={8} onPress={onAction}>
        {actionIcon === 'revert' ? (
          <ArrowCounterClockwiseIcon size={14} color={theme.palette.sky.text} weight="bold" />
        ) : (
          <CheckIcon size={14} color={theme.palette.green.text} weight="bold" />
        )}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    marginHorizontal: 12,
    borderRadius: 12,
    backgroundColor: theme.palette.slate.surfaceDeep,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9 },
  tabActive: { backgroundColor: theme.palette.slate.surface },
  tabText: { color: theme.palette.slate.textMuted, fontSize: 12, fontWeight: '800' },
  tabTextActive: { color: theme.palette.slate.textPrimary },
  scroll: { flex: 1 },
  content: { padding: 12, gap: 8 },
  gaugeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gaugeWrap: { width: '48.5%' },
  gauge: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: theme.palette.slate.surface,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    gap: 8,
  },
  gaugeHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  gaugeLabel: {
    flex: 1,
    color: theme.palette.slate.textSecondary,
    fontSize: 11,
    fontWeight: '800',
  },
  gaugeWord: { fontSize: 19, fontWeight: '900' },
  segments: { flexDirection: 'row', gap: 3 },
  segment: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    backgroundColor: theme.palette.slate.surfaceDeep,
  },
  gaugeFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gaugeNumber: {
    color: theme.palette.slate.textMuted,
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  gaugeResnap: { color: theme.palette.yellow.text, fontSize: 10, fontWeight: '900' },
  group: { gap: 2, paddingTop: 6 },
  groupTitle: {
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingVertical: 8,
  },
  denseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.palette.slate.border,
  },
  denseLabel: { flex: 1, minWidth: 0, color: theme.palette.slate.textPrimary, fontSize: 13 },
  denseId: { color: theme.palette.slate.textDim, fontSize: 10, maxWidth: 120 },
  denseValue: {
    color: theme.palette.slate.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    minWidth: 52,
    textAlign: 'right',
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginBottom: 4,
    backgroundColor: theme.palette.slate.surface,
  },
  changeText: { flex: 1, minWidth: 0, gap: 2 },
  changeValue: { fontSize: 11, fontWeight: '800' },
  changeAction: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.palette.slate.surfaceDeep,
  },
  empty: { color: theme.palette.slate.textMuted, fontSize: 13, padding: 24, textAlign: 'center' },
})
