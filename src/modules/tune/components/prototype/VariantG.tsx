// PROTOTYPE — throwaway. Variant G: tune the board by touching its physical zones.

import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CircleIcon,
  HandPalmIcon,
  LightningIcon,
  MountainsIcon,
  WaveSineIcon,
} from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { applySliderValue, stepLabel } from '@/modules/tune/components/prototype/concerns'
import type { TuneVariantProps } from '@/modules/tune/components/prototype/types'
import type { BasicSliderItem } from '@/modules/tune/lib/sliderDefinitions'

export const VARIANT_G_NAME = 'Board anatomy'

type Zone = 'nose' | 'core' | 'tail'

const ZONES = [
  { id: 'nose', label: 'Nose', icon: ArrowUpIcon, color: theme.palette.teal.color },
  { id: 'core', label: 'Core', icon: CircleIcon, color: theme.palette.sky.color },
  { id: 'tail', label: 'Tail', icon: ArrowDownIcon, color: theme.palette.orange.color },
] as const

export function VariantG(props: TuneVariantProps) {
  const insets = useSafeAreaInsets()
  const [zone, setZone] = useState<Zone>('core')
  const sliders = useMemo(
    () => new Map(props.basicSliders.map((item) => [item.id, item])),
    [props.basicSliders],
  )

  return (
    <ScrollView
      style={styles.scroll}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 112 }]}
    >
      <View style={styles.heading}>
        <Text style={styles.title}>Tune the board</Text>
        <Text style={styles.subtitle}>Tap where you want to change the feel</Text>
      </View>

      <BoardMap zone={zone} onZone={setZone} sliders={sliders} />

      <View style={styles.zoneTabs}>
        {ZONES.map((item) => {
          const Icon = item.icon
          const active = zone === item.id
          return (
            <Pressable key={item.id} style={styles.zoneTab} onPress={() => setZone(item.id)}>
              <Icon
                size={17}
                color={active ? item.color : theme.palette.slate.textMuted}
                weight="duotone"
              />
              <Text style={[styles.zoneTabText, active && { color: item.color }]}>
                {item.label}
              </Text>
              <View style={[styles.zoneUnderline, active && { backgroundColor: item.color }]} />
            </Pressable>
          )
        })}
      </View>

      <ZoneControls zone={zone} sliders={sliders} setDraftField={props.setDraftField} />

      <Text style={styles.sectionTitle}>Behavior layers</Text>
      <View style={styles.layers}>
        <LayerCard
          item={sliders.get('carveTilt')}
          icon={WaveSineIcon}
          color={theme.palette.pink.color}
          label="Cornering"
          setDraftField={props.setDraftField}
        />
        <LayerCard
          item={sliders.get('brakeTilt')}
          icon={HandPalmIcon}
          color={theme.palette.orange.color}
          label="Hard braking"
          setDraftField={props.setDraftField}
        />
        <LayerCard
          item={sliders.get('atrIntensity')}
          icon={MountainsIcon}
          color={theme.palette.green.color}
          label="Terrain"
          setDraftField={props.setDraftField}
        />
      </View>
    </ScrollView>
  )
}

function BoardMap({
  zone,
  onZone,
  sliders,
}: {
  zone: Zone
  onZone: (zone: Zone) => void
  sliders: Map<string, BasicSliderItem>
}) {
  return (
    <View style={styles.boardStage}>
      <View style={styles.axis} />
      <View style={styles.wheelOuter}>
        <View style={styles.wheelInner} />
      </View>
      <View style={styles.boardBody}>
        {ZONES.map((item) => (
          <Pressable
            key={item.id}
            style={[
              styles.boardZone,
              zone === item.id && { backgroundColor: theme.alpha(item.color, 0.12) },
            ]}
            onPress={() => onZone(item.id)}
          >
            <View style={[styles.zoneDot, { borderColor: item.color }]} />
          </Pressable>
        ))}
      </View>
      <Text style={[styles.mapReadout, { left: 18, color: theme.palette.teal.color }]}>
        {stepLabelOrDash(sliders.get('noseStiffness'))}
      </Text>
      <Text style={[styles.mapReadout, { alignSelf: 'center', color: theme.palette.sky.color }]}>
        {stepLabelOrDash(sliders.get('aggressiveness'))}
      </Text>
      <Text style={[styles.mapReadout, { right: 18, color: theme.palette.orange.color }]}>
        {stepLabelOrDash(sliders.get('tailStiffness'))}
      </Text>
    </View>
  )
}

function ZoneControls({
  zone,
  sliders,
  setDraftField,
}: {
  zone: Zone
  sliders: Map<string, BasicSliderItem>
  setDraftField: TuneVariantProps['setDraftField']
}) {
  const id =
    zone === 'nose' ? 'noseStiffness' : zone === 'tail' ? 'tailStiffness' : 'aggressiveness'
  const item = sliders.get(id)
  if (!item) return null
  const color =
    zone === 'nose'
      ? theme.palette.teal.color
      : zone === 'tail'
        ? theme.palette.orange.color
        : theme.palette.sky.color
  const Icon = zone === 'nose' ? ArrowUpIcon : zone === 'tail' ? ArrowDownIcon : LightningIcon
  return (
    <View style={styles.focusControl}>
      <View style={styles.focusHead}>
        <Icon size={21} color={color} weight="duotone" />
        <View style={styles.focusCopy}>
          <Text style={styles.focusTitle}>
            {zone === 'core'
              ? 'Balance response'
              : `${zone === 'nose' ? 'Nose' : 'Tail'} stiffness`}
          </Text>
          <Text style={styles.focusHint}>
            {zone === 'core'
              ? 'How firmly the board returns under your feet'
              : zone === 'nose'
                ? 'Support while accelerating and climbing'
                : 'Support while slowing down and descending'}
          </Text>
        </View>
        <Text style={[styles.focusLevel, { color }]}>{stepLabel(item)}</Text>
      </View>
      <BarPicker
        item={item}
        color={color}
        onChange={(value) => applySliderValue(item.id, value, setDraftField)}
      />
      <View style={styles.ends}>
        <Text style={styles.endLabel}>{zone === 'core' ? 'Calm' : 'Soft'}</Text>
        <Text style={styles.endLabel}>{zone === 'core' ? 'Immediate' : 'Firm'}</Text>
      </View>
    </View>
  )
}

function LayerCard({
  item,
  icon: Icon,
  color,
  label,
  setDraftField,
}: {
  item?: BasicSliderItem
  icon: typeof LightningIcon
  color: string
  label: string
  setDraftField: TuneVariantProps['setDraftField']
}) {
  if (!item) return null
  const level = normalized(item)
  const next = level >= 8 ? 2 : level + 2
  return (
    <Pressable
      style={styles.layer}
      onPress={() =>
        applySliderValue(item.id, item.min + (next / 10) * (item.max - item.min), setDraftField)
      }
    >
      <Icon size={19} color={color} weight="duotone" />
      <View style={styles.layerCopy}>
        <Text style={styles.layerLabel}>{label}</Text>
        <Text style={styles.layerHint}>{item.description}</Text>
      </View>
      <View style={styles.layerState}>
        <Text style={[styles.layerWord, { color }]}>{stepLabel(item)}</Text>
        <MiniGauge value={level} color={color} />
      </View>
    </Pressable>
  )
}

function BarPicker({
  item,
  color,
  onChange,
}: {
  item: BasicSliderItem
  color: string
  onChange: (value: number) => void
}) {
  const level = normalized(item)
  return (
    <View style={styles.barPicker}>
      {[0, 2, 4, 6, 8, 10].map((mark) => (
        <Pressable
          key={mark}
          style={styles.barHit}
          onPress={() => onChange(item.min + (mark / 10) * (item.max - item.min))}
        >
          <View
            style={[
              styles.bar,
              { height: 7 + mark * 1.7 },
              mark <= level && { backgroundColor: color },
            ]}
          />
        </Pressable>
      ))}
    </View>
  )
}

function MiniGauge({ value, color }: { value: number; color: string }) {
  return (
    <View style={styles.miniGauge}>
      {[2, 4, 6, 8, 10].map((mark) => (
        <View key={mark} style={[styles.miniMark, mark <= value && { backgroundColor: color }]} />
      ))}
    </View>
  )
}
function normalized(item: BasicSliderItem) {
  return item.value == null ? 0 : Math.round(((item.value - item.min) / (item.max - item.min)) * 10)
}
function stepLabelOrDash(item?: BasicSliderItem) {
  return item ? stepLabel(item) : '—'
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, gap: 16 },
  heading: { gap: 2 },
  title: { color: theme.palette.slate.textPrimary, fontSize: 22, fontWeight: '800' },
  subtitle: { color: theme.palette.slate.textMuted, fontSize: 12 },
  boardStage: { height: 210, justifyContent: 'center' },
  axis: {
    position: 'absolute',
    left: 22,
    right: 22,
    top: 104,
    height: 1,
    backgroundColor: theme.palette.slate.border,
  },
  wheelOuter: {
    position: 'absolute',
    alignSelf: 'center',
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    borderColor: theme.palette.slate.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelInner: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: theme.palette.sky.color,
  },
  boardBody: {
    height: 52,
    flexDirection: 'row',
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: theme.palette.slate.textPrimary,
    overflow: 'hidden',
    zIndex: 2,
  },
  boardZone: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  zoneDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5 },
  mapReadout: { position: 'absolute', bottom: 10, fontSize: 11, fontWeight: '800' },
  zoneTabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: theme.palette.slate.border,
  },
  zoneTab: { flex: 1, alignItems: 'center', gap: 4, paddingTop: 8 },
  zoneTabText: { color: theme.palette.slate.textMuted, fontSize: 11, fontWeight: '800' },
  zoneUnderline: { width: 34, height: 2, marginTop: 4, backgroundColor: theme.palette.slate.bg },
  focusControl: { gap: 14, paddingVertical: 4 },
  focusHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  focusCopy: { flex: 1, gap: 2 },
  focusTitle: { color: theme.palette.slate.textPrimary, fontSize: 15, fontWeight: '800' },
  focusHint: { color: theme.palette.slate.textMuted, fontSize: 10 },
  focusLevel: { fontSize: 13, fontWeight: '900' },
  barPicker: { height: 42, flexDirection: 'row', alignItems: 'flex-end', gap: 5 },
  barHit: { flex: 1, height: 42, justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 4, backgroundColor: theme.palette.slate.surfaceDeep },
  ends: { flexDirection: 'row', justifyContent: 'space-between' },
  endLabel: { color: theme.palette.slate.textMuted, fontSize: 10 },
  sectionTitle: {
    paddingTop: 10,
    color: theme.palette.slate.textMuted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  layers: { gap: 2 },
  layer: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.palette.slate.border,
  },
  layerCopy: { flex: 1, gap: 2 },
  layerLabel: { color: theme.palette.slate.textPrimary, fontSize: 13, fontWeight: '800' },
  layerHint: { color: theme.palette.slate.textMuted, fontSize: 9 },
  layerState: { alignItems: 'flex-end', gap: 5 },
  layerWord: { fontSize: 11, fontWeight: '900' },
  miniGauge: { width: 58, flexDirection: 'row', gap: 3 },
  miniMark: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.palette.slate.surfaceDeep,
  },
})
