import { useRef, useState } from 'react'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'
import { CaretDownIcon, CaretRightIcon, MagnifyingGlassIcon } from 'phosphor-react-native'
import type { RefloatConfigField } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import type { TuneVariantProps } from '@/modules/tune/components/prototype/types'
import { formatTuneValue } from '@/modules/tune/lib/fields'
import { formatSliderValue, type BasicSliderItem } from '@/modules/tune/lib/sliderDefinitions'

export function VariantFOverview({
  sliders,
  props,
}: {
  sliders: Map<string, BasicSliderItem>
  props: TuneVariantProps
}) {
  const [showAllFields, setShowAllFields] = useState(false)
  const [fieldQuery, setFieldQuery] = useState('')
  const changedFields = props.displayGroups
    .flatMap((group) => group.fields)
    .filter((field) => Object.prototype.hasOwnProperty.call(props.dirtyFields, field.id))
  const query = fieldQuery.trim().toLowerCase()
  const filteredGroups = props.displayGroups
    .map((group) => ({
      ...group,
      fields: group.fields.filter((field) =>
        `${field.label} ${field.id}`.toLowerCase().includes(query),
      ),
    }))
    .filter((group) => group.fields.length > 0)

  return (
    <View style={styles.overview}>
      <Section title="Rider controls">
        {[...sliders.values()].map((item) => (
          <BasicRow key={item.id} item={item} onPress={props.openBasicSliderEditor} />
        ))}
      </Section>
      <Section title="Changed VESC parameters" count={changedFields.length}>
        {changedFields.length ? (
          changedFields.map((field) => (
            <NativeRow key={field.id} field={field} onPress={props.openFieldEditor} />
          ))
        ) : (
          <Text style={styles.empty}>No native VESC parameters changed.</Text>
        )}
      </Section>
      <View style={styles.section}>
        <View style={styles.allHeader}>
          <Pressable
            style={styles.toggle}
            accessibilityRole="button"
            accessibilityState={{ expanded: showAllFields }}
            onPress={() => setShowAllFields((visible) => !visible)}
          >
            <Text style={styles.sectionTitle}>All VESC parameters</Text>
            <CaretDownIcon
              size={13}
              color={theme.palette.slate.textMuted}
              weight="bold"
              style={{ transform: [{ rotate: showAllFields ? '180deg' : '0deg' }] }}
            />
          </Pressable>
          <View style={styles.search}>
            <MagnifyingGlassIcon size={12} color={theme.palette.slate.textMuted} weight="bold" />
            <TextInput
              style={styles.searchInput}
              value={fieldQuery}
              placeholder="Search"
              placeholderTextColor={theme.palette.slate.textDim}
              autoCorrect={false}
              autoCapitalize="none"
              onFocus={() => setShowAllFields(true)}
              onChangeText={(value) => {
                setFieldQuery(value)
                setShowAllFields(true)
              }}
            />
          </View>
        </View>
        {showAllFields
          ? filteredGroups.map((group) => (
              <View key={group.id} style={styles.group}>
                <Text style={styles.groupTitle}>{group.title}</Text>
                {group.fields.map((field) => (
                  <NativeRow key={field.id} field={field} onPress={props.openFieldEditor} />
                ))}
              </View>
            ))
          : null}
        {showAllFields && filteredGroups.length === 0 ? (
          <Text style={styles.empty}>No VESC parameters match “{fieldQuery}”.</Text>
        ) : null}
      </View>
    </View>
  )
}

function Section({
  title,
  count,
  children,
}: React.PropsWithChildren<{ title: string; count?: number }>) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {count != null ? <Text style={styles.count}>{count}</Text> : null}
      </View>
      {children}
    </View>
  )
}

function BasicRow({
  item,
  onPress,
}: {
  item: BasicSliderItem
  onPress: TuneVariantProps['openBasicSliderEditor']
}) {
  const ref = useRef<View>(null)
  return (
    <Pressable ref={ref} style={rowStyle} onPress={() => onPress(item.id, ref)}>
      <Text style={styles.label}>{item.label}</Text>
      <Value value={formatSliderValue(item)} color={theme.tune.color} />
    </Pressable>
  )
}

function NativeRow({
  field,
  onPress,
}: {
  field: RefloatConfigField
  onPress: TuneVariantProps['openFieldEditor']
}) {
  const ref = useRef<View>(null)
  return (
    <Pressable
      ref={ref}
      style={rowStyle}
      onPress={() => onPress(field, ref, theme.palette.purple.color)}
    >
      <View style={styles.identity}>
        <Text style={styles.label}>{field.label}</Text>
        <Text style={styles.fieldId}>{field.id}</Text>
      </View>
      <Value
        value={`${formatTuneValue(field.value)}${field.unit ? ` ${field.unit}` : ''}`}
        color={theme.palette.purple.color}
      />
    </Pressable>
  )
}

function Value({ value, color }: { value: string; color: string }) {
  return (
    <View style={styles.valueWrap}>
      <Text style={[styles.value, { color }]}>{value}</Text>
      <CaretRightIcon size={14} color={theme.palette.slate.textMuted} weight="bold" />
    </View>
  )
}

const rowStyle = ({ pressed }: { pressed: boolean }) => [styles.row, pressed && styles.pressed]
const styles = StyleSheet.create({
  overview: { gap: 18 },
  section: { gap: 2 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: {
    paddingBottom: 5,
    color: theme.palette.slate.textMuted,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  count: { color: theme.palette.purple.color, fontFamily: theme.mono('700'), fontSize: 11 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: theme.palette.slate.border,
  },
  pressed: { backgroundColor: theme.palette.slate.surface },
  label: { flex: 1, color: theme.palette.slate.textPrimary, fontSize: 13, fontWeight: '700' },
  valueWrap: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  value: { fontFamily: theme.mono('700'), fontSize: 13, fontVariant: ['tabular-nums'] },
  identity: { flex: 1, gap: 2 },
  fieldId: { color: theme.palette.slate.textMuted, fontFamily: theme.mono('500'), fontSize: 9 },
  empty: { paddingVertical: 16, color: theme.palette.slate.textMuted, fontSize: 12 },
  allHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  search: {
    width: 112,
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    borderRadius: 9,
    backgroundColor: theme.palette.slate.surfaceDeep,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    color: theme.palette.slate.textPrimary,
    fontFamily: theme.font('600'),
    fontSize: 10,
  },
  group: { gap: 2, paddingTop: 8 },
  groupTitle: { color: theme.palette.slate.textSecondary, fontSize: 11, fontWeight: '800' },
})
