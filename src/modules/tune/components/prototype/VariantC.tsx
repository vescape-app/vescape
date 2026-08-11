// PROTOTYPE — throwaway. Variant C: there is only one list. "Basic" is a lens over it.
// Power-user first: search + filters over every raw field, with the six macros pinned
// on top as rows that write several fields at once.

import { useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MagnifyingGlassIcon } from 'phosphor-react-native'
import type { RefloatConfigField } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { formatTuneValue } from '@/modules/tune/lib/fields'
import { formatSliderValue } from '@/modules/tune/lib/sliderDefinitions'
import {
  CONCERN_BY_GROUP_ID,
  SLIDER_ICON,
  stepLabel,
} from '@/modules/tune/components/prototype/concerns'
import type { TuneVariantProps } from '@/modules/tune/components/prototype/types'

export const VARIANT_C_NAME = 'One searchable list'

type Filter = 'all' | 'macros' | 'edited' | 'board'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'macros', label: 'Macros' },
  { id: 'edited', label: 'Edited' },
  { id: 'board', label: 'Board diff' },
]

export function VariantC(props: TuneVariantProps) {
  const insets = useSafeAreaInsets()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return props.displayGroups.flatMap((group) =>
      group.fields
        .filter((field) => {
          if (needle && !`${field.label} ${field.id}`.toLowerCase().includes(needle)) return false
          if (filter === 'edited')
            return Object.prototype.hasOwnProperty.call(props.dirtyFields, field.id)
          if (filter === 'board') return props.boardDiffByField.has(field.id)
          if (filter === 'macros') return false
          return true
        })
        .map((field) => ({ field, groupId: group.id, groupTitle: group.title })),
    )
  }, [filter, props.boardDiffByField, props.dirtyFields, props.displayGroups, query])

  const showMacros = filter === 'all' || filter === 'macros'

  return (
    <View style={styles.root}>
      <View style={styles.searchBar}>
        <MagnifyingGlassIcon size={16} color={theme.palette.slate.textMuted} weight="bold" />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search 40+ values (kp, atr, tiltback...)"
          placeholderTextColor={theme.palette.slate.textDim}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>
      <View style={styles.filterRow}>
        {FILTERS.map((item) => (
          <Pressable
            key={item.id}
            style={[styles.filterChip, filter === item.id && styles.filterChipActive]}
            onPress={() => setFilter(item.id)}
          >
            <Text style={[styles.filterText, filter === item.id && styles.filterTextActive]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
        keyboardShouldPersistTaps="handled"
      >
        {showMacros ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Macros - write several fields at once</Text>
            {props.basicSliders.map((slider) => {
              const Icon = SLIDER_ICON[slider.id]
              return (
                <MacroRow
                  key={slider.id}
                  label={slider.label}
                  word={stepLabel(slider)}
                  number={formatSliderValue(slider)}
                  drifted={slider.modifiedManually}
                  icon={Icon}
                  onPress={props.openBasicSliderEditor}
                  sliderId={slider.id}
                  onResetFormula={() => props.resetSliderFormula(slider.id)}
                />
              )
            })}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {rows.length} raw {rows.length === 1 ? 'field' : 'fields'}
          </Text>
          {rows.map(({ field, groupId, groupTitle }) => (
            <FieldRow
              key={field.id}
              field={field}
              context={CONCERN_BY_GROUP_ID.get(groupId)?.title ?? groupTitle}
              color={CONCERN_BY_GROUP_ID.get(groupId)?.color ?? theme.palette.sky.color}
              dirty={Object.prototype.hasOwnProperty.call(props.dirtyFields, field.id)}
              boardChanged={props.boardDiffByField.has(field.id)}
              onPress={props.openFieldEditor}
            />
          ))}
          {rows.length === 0 && !showMacros ? (
            <Text style={styles.empty}>Nothing matches.</Text>
          ) : null}
        </View>
      </ScrollView>
    </View>
  )
}

function MacroRow({
  label,
  word,
  number,
  drifted,
  icon: Icon,
  sliderId,
  onPress,
  onResetFormula,
}: {
  label: string
  word: string
  number: string
  drifted: boolean
  icon?: React.ComponentType<{ size: number; color: string; weight?: 'duotone' }>
  sliderId: string
  onPress: TuneVariantProps['openBasicSliderEditor']
  onResetFormula: () => void
}) {
  const ref = useRef<View | null>(null)
  return (
    <View ref={ref}>
      <Pressable style={styles.macroRow} onPress={() => onPress(sliderId, ref)}>
        {Icon ? <Icon size={16} color={theme.tune.color} weight="duotone" /> : null}
        <Text style={styles.macroLabel}>{label}</Text>
        {drifted ? (
          <Pressable hitSlop={8} onPress={onResetFormula} style={styles.driftBadge}>
            <Text style={styles.driftText}>drifted - resnap</Text>
          </Pressable>
        ) : null}
        <Text style={styles.macroWord}>{word}</Text>
        <Text style={styles.macroNumber}>{number}</Text>
      </Pressable>
    </View>
  )
}

function FieldRow({
  field,
  context,
  color,
  dirty,
  boardChanged,
  onPress,
}: {
  field: RefloatConfigField
  context: string
  color: string
  dirty: boolean
  boardChanged: boolean
  onPress: TuneVariantProps['openFieldEditor']
}) {
  const ref = useRef<View | null>(null)
  return (
    <View ref={ref}>
      <Pressable style={styles.fieldRow} onPress={() => onPress(field, ref, color)}>
        <View style={[styles.tag, { backgroundColor: theme.alpha(color, 0.12) }]}>
          <Text style={[styles.tagText, { color }]} numberOfLines={1}>
            {context}
          </Text>
        </View>
        <View style={styles.fieldText}>
          <Text style={styles.fieldLabel} numberOfLines={1}>
            {field.label}
          </Text>
          <Text style={styles.fieldId} numberOfLines={1}>
            {field.id}
          </Text>
        </View>
        {dirty ? <View style={[styles.dot, { backgroundColor: theme.palette.sky.color }]} /> : null}
        {boardChanged ? (
          <View style={[styles.dot, { backgroundColor: theme.palette.green.color }]} />
        ) : null}
        <Text style={styles.fieldValue}>
          {formatTuneValue(field.value)}
          {field.unit ? <Text style={styles.fieldUnit}> {field.unit}</Text> : null}
        </Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: theme.palette.slate.surface,
  },
  searchInput: {
    flex: 1,
    color: theme.palette.slate.textPrimary,
    fontSize: 14,
    paddingVertical: 10,
  },
  filterRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: theme.palette.slate.surfaceDeep,
  },
  filterChipActive: { backgroundColor: theme.tune.bg },
  filterText: { color: theme.palette.slate.textMuted, fontSize: 12, fontWeight: '800' },
  filterTextActive: { color: theme.tune.color },
  scroll: { flex: 1 },
  section: { paddingHorizontal: 12, paddingTop: 6 },
  sectionTitle: {
    color: theme.palette.slate.textMuted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingVertical: 8,
  },
  macroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginBottom: 4,
    backgroundColor: theme.palette.slate.surface,
  },
  macroLabel: { flex: 1, color: theme.palette.slate.textPrimary, fontSize: 13, fontWeight: '800' },
  macroWord: { color: theme.palette.slate.textSecondary, fontSize: 12, fontWeight: '700' },
  macroNumber: {
    color: theme.tune.color,
    fontSize: 15,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    minWidth: 34,
    textAlign: 'right',
  },
  driftBadge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: theme.palette.yellow.bg,
  },
  driftText: { color: theme.palette.yellow.text, fontSize: 10, fontWeight: '800' },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: theme.palette.slate.border,
  },
  tag: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3, maxWidth: 86 },
  tagText: { fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
  fieldText: { flex: 1, minWidth: 0 },
  fieldLabel: { color: theme.palette.slate.textPrimary, fontSize: 13, fontWeight: '700' },
  fieldId: { color: theme.palette.slate.textDim, fontSize: 10 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  fieldValue: {
    color: theme.palette.slate.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  fieldUnit: { color: theme.palette.slate.textMuted, fontSize: 10 },
  empty: { color: theme.palette.slate.textMuted, fontSize: 13, padding: 16, textAlign: 'center' },
})
