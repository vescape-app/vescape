// PROTOTYPE — throwaway. Variant F: four rider-facing modes with a bottom icon rail.

import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Canvas, LinearGradient, RoundedRect, vec } from '@shopify/react-native-skia'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import type { TuneProfileFieldValue } from 'vescape-core'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  GaugeIcon,
  HandPalmIcon,
  LightningIcon,
  MountainsIcon,
  SlidersHorizontalIcon,
  WaveSineIcon,
} from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { Select, type SelectOption } from '@/components/forms/Select'
import { InfoModal } from '@/components/modals/InfoModal'
import { theme } from '@/constants/theme'
import { TuneDial } from '@/modules/tune/components/TuneDial'
import { TunePreview } from '@/modules/tune/components/TunePreview'
import { applySliderValue, stepLabel } from '@/modules/tune/components/prototype/concerns'
import type { TuneVariantProps } from '@/modules/tune/components/prototype/types'
import { formatSliderValue, type BasicSliderItem } from '@/modules/tune/lib/sliderDefinitions'
import { VariantFOverview } from '@/modules/tune/components/prototype/VariantFOverview'

export const VARIANT_F_NAME = 'Ride modes'

type Mode = 'response' | 'style' | 'terrain' | 'overview'

const MODES = [
  { id: 'response', label: 'Response', icon: LightningIcon, color: theme.palette.sky.color },
  { id: 'style', label: 'Ride style', icon: WaveSineIcon, color: theme.palette.pink.color },
  { id: 'terrain', label: 'Terrain', icon: MountainsIcon, color: theme.palette.green.color },
  { id: 'overview', label: 'Overview', icon: GaugeIcon, color: theme.palette.purple.color },
] as const

type PreviewPresetId = 'flat' | 'small' | 'large' | 'pumptrack'

const PREVIEW_PRESETS: Record<
  PreviewPresetId,
  { label: string; hillsEnabled: boolean; height: number; spacing: number }
> = {
  flat: { label: 'Flat', hillsEnabled: false, height: 0, spacing: 0 },
  small: { label: 'Small hills', hillsEnabled: true, height: 2, spacing: 24 },
  large: { label: 'Large hills', hillsEnabled: true, height: 8, spacing: 90 },
  pumptrack: { label: 'Pumptrack', hillsEnabled: true, height: 0.5, spacing: 5 },
}

const PREVIEW_PRESET_OPTIONS: SelectOption<PreviewPresetId>[] = Object.entries(PREVIEW_PRESETS).map(
  ([value, preset]) => ({ value: value as PreviewPresetId, label: preset.label }),
)

export function VariantF(props: TuneVariantProps) {
  const insets = useSafeAreaInsets()
  const [mode, setMode] = useState<Mode>('response')
  const [presetId, setPresetId] = useState<PreviewPresetId>('small')
  const sliders = useMemo(
    () => new Map(props.basicSliders.map((slider) => [slider.id, slider])),
    [props.basicSliders],
  )
  const previewFields = useMemo(
    () =>
      Object.fromEntries(
        props.displayGroups.flatMap((group) =>
          group.fields.map((field) => [field.id, field.value]),
        ),
      ),
    [props.displayGroups],
  )

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + (mode === 'terrain' ? 230 : 170) },
        ]}
      >
        <ModeHero mode={mode} presetId={presetId} onPresetChange={setPresetId} />
        <PreviewPanel fields={previewFields} presetId={presetId} />
        {mode === 'response' ? (
          <ResponsePage sliders={sliders} setDraftField={props.setDraftField} />
        ) : null}
        {mode === 'style' ? (
          <StylePage sliders={sliders} setDraftField={props.setDraftField} />
        ) : null}
        {mode === 'terrain' ? <TerrainPage props={props} /> : null}
        {mode === 'overview' ? <VariantFOverview sliders={sliders} props={props} /> : null}
      </ScrollView>

      <View style={[styles.modeRail, { bottom: insets.bottom + 154 }]}>
        {MODES.map((item) => {
          const Icon = item.icon
          const active = mode === item.id
          return (
            <Pressable key={item.id} style={styles.modeButton} onPress={() => setMode(item.id)}>
              <Icon
                size={20}
                color={active ? item.color : theme.palette.slate.textMuted}
                weight="duotone"
              />
              <Text style={[styles.modeLabel, active && { color: item.color }]}>{item.label}</Text>
              <View style={[styles.modeMark, active && { backgroundColor: item.color }]} />
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

function ResponsePage({
  sliders,
  setDraftField,
}: {
  sliders: Map<string, BasicSliderItem>
  setDraftField: TuneVariantProps['setDraftField']
}) {
  const items = ['aggressiveness', 'noseStiffness', 'tailStiffness']
    .map((id) => sliders.get(id))
    .filter((item): item is BasicSliderItem => item != null)
  return (
    <View style={styles.triple}>
      {items.map((item, index) => (
        <CompactControl
          key={item.id}
          item={item}
          icon={index === 0 ? LightningIcon : index === 1 ? ArrowUpIcon : ArrowDownIcon}
          color={
            index === 0
              ? theme.palette.sky.color
              : index === 1
                ? theme.palette.teal.color
                : theme.palette.orange.color
          }
          onValue={(value) => applySliderValue(item.id, value, setDraftField)}
        />
      ))}
    </View>
  )
}

function StylePage({
  sliders,
  setDraftField,
}: {
  sliders: Map<string, BasicSliderItem>
  setDraftField: TuneVariantProps['setDraftField']
}) {
  return (
    <>
      <View style={styles.split}>
        {(['carveTilt', 'brakeTilt'] as const).map((id) => {
          const item = sliders.get(id)
          if (!item) return null
          return (
            <WideControl
              key={id}
              item={item}
              icon={id === 'carveTilt' ? WaveSineIcon : HandPalmIcon}
              color={id === 'carveTilt' ? theme.palette.pink.color : theme.palette.orange.color}
              topLabel={id === 'carveTilt' ? 'More carve' : 'More brake support'}
              bottomLabel={id === 'carveTilt' ? 'Less carve' : 'Less brake support'}
              onValue={(value) => applySliderValue(id, value, setDraftField)}
            />
          )
        })}
      </View>
    </>
  )
}

function TerrainPage({ props }: { props: TuneVariantProps }) {
  const up = findField(props, 'atr_strength_up')
  const down = findField(props, 'atr_strength_down')
  const upReaction = findField(props, 'atr_response_boost')
  const downReaction = findField(props, 'atr_transition_boost')
  return (
    <>
      <View style={styles.split}>
        <AtrColumn
          title="Climb assist"
          icon={ArrowUpIcon}
          color={theme.palette.green.color}
          value={fieldLevel(up?.value, 0, 2)}
          reaction={fieldLevel(upReaction?.value, upReaction?.min ?? 0, upReaction?.max ?? 10)}
          onValue={(value) => up && props.setDraftField(up.id, value / 5)}
          onReaction={(value) => setFieldLevel(upReaction, value, props.setDraftField)}
        />
        <AtrColumn
          title="Descent assist"
          icon={ArrowDownIcon}
          color={theme.palette.teal.color}
          value={fieldLevel(down?.value, 0, 2)}
          reaction={fieldLevel(
            downReaction?.value,
            downReaction?.min ?? 0,
            downReaction?.max ?? 10,
          )}
          onValue={(value) => down && props.setDraftField(down.id, value / 5)}
          onReaction={(value) => setFieldLevel(downReaction, value, props.setDraftField)}
        />
      </View>
    </>
  )
}

function ModeHero({
  mode,
  presetId,
  onPresetChange,
}: {
  mode: Mode
  presetId: PreviewPresetId
  onPresetChange: (preset: PreviewPresetId) => void
}) {
  const content = {
    response: ['Board response', 'How firmly the board holds you', theme.palette.sky.color],
    style: ['Ride character', 'Carving and braking, tuned separately', theme.palette.pink.color],
    terrain: ['Terrain assist', 'Independent help uphill and downhill', theme.palette.green.color],
    overview: ['Tune overview', 'One glance before saving', theme.palette.purple.color],
  }[mode] as [string, string, string]
  return (
    <View style={styles.hero}>
      <View style={styles.heroIdentity}>
        <SlidersHorizontalIcon size={20} color={content[2]} weight="duotone" />
        <View style={styles.heroCopy}>
          <Text style={styles.title}>{content[0]}</Text>
          <Text style={styles.subtitle}>{content[1]}</Text>
        </View>
      </View>
      <View style={styles.previewSelectRow}>
        <MountainsIcon size={13} color={theme.palette.green.color} weight="duotone" />
        <Select
          options={PREVIEW_PRESET_OPTIONS}
          value={presetId}
          onChange={onPresetChange}
          style={styles.previewSelect}
          textStyle={styles.previewSelectText}
        />
      </View>
    </View>
  )
}

function PreviewPanel({
  fields,
  presetId,
}: {
  fields: Record<string, TuneProfileFieldValue>
  presetId: PreviewPresetId
}) {
  const [helpVisible, setHelpVisible] = useState(false)
  const preset = PREVIEW_PRESETS[presetId]
  const pitchInputDegrees = useSharedValue(0)
  const pitchInputActive = useSharedValue(false)
  const speedKmh = useSharedValue(15)
  const groundToBoardAngleDegrees = useSharedValue(0)

  return (
    <>
      <View style={styles.previewWrap}>
        <TunePreview
          fields={fields}
          pitchInputDegrees={pitchInputDegrees}
          pitchInputActive={pitchInputActive}
          hillsEnabled={preset.hillsEnabled}
          hillHeightMeters={preset.height}
          hillSpacingMeters={preset.spacing}
          speedKmh={speedKmh}
          groundToBoardAngleDegrees={groundToBoardAngleDegrees}
          active
          minimal
          onHelp={() => setHelpVisible(true)}
        />
      </View>
      <InfoModal
        visible={helpVisible}
        variant="warning"
        title="Comparison preview"
        message={`This preview compares Tune settings using a 15 km/h start and the ${preset.label} terrain preset. It is not a real-world riding simulation.`}
        onDismiss={() => setHelpVisible(false)}
      />
    </>
  )
}

function CompactControl({
  item,
  icon: Icon,
  color,
  onValue,
}: {
  item: BasicSliderItem
  icon: typeof LightningIcon
  color: string
  onValue: (value: number) => void
}) {
  return (
    <View style={styles.compact}>
      <ControlIntro
        icon={Icon}
        title={item.label.replace(' stiffness', '')}
        description={controlDescription(item.id)}
        color={color}
        compact
      />
      <View style={styles.faderRow}>
        <LiquidFader
          value={normalized(item)}
          color={color}
          onChange={(level) => onValue(item.min + (level / 10) * (item.max - item.min))}
          height={160}
        />
        <StatusReadout number={formatSliderValue(item)} word={stepLabel(item)} color={color} />
      </View>
    </View>
  )
}

function WideControl({
  item,
  icon: Icon,
  color,
  topLabel,
  bottomLabel,
  onValue,
}: {
  item: BasicSliderItem
  icon: typeof LightningIcon
  color: string
  topLabel: string
  bottomLabel: string
  onValue: (value: number) => void
}) {
  return (
    <View style={styles.dualControl}>
      <ControlIntro
        icon={Icon}
        title={item.label}
        description={controlDescription(item.id)}
        color={color}
      />
      <View style={styles.verticalScale}>
        <Text style={styles.axisLabel}>{topLabel}</Text>
        <View style={styles.faderRow}>
          <LiquidFader
            value={normalized(item)}
            color={color}
            onChange={(level) => onValue(item.min + (level / 10) * (item.max - item.min))}
            height={166}
          />
          <StatusReadout number={formatSliderValue(item)} word={stepLabel(item)} color={color} />
        </View>
        <Text style={styles.axisLabel}>{bottomLabel}</Text>
      </View>
    </View>
  )
}

function AtrColumn({
  title,
  icon: Icon,
  color,
  value,
  reaction,
  onValue,
  onReaction,
}: {
  title: string
  icon: typeof LightningIcon
  color: string
  value: number
  reaction: number
  onValue: (value: number) => void
  onReaction: (value: number) => void
}) {
  const description =
    title === 'Climb assist'
      ? 'Lifts the nose as the terrain rises.'
      : 'Keeps the board composed on descents.'

  return (
    <View style={styles.dualControl}>
      <ControlIntro icon={Icon} title={title} description={description} color={color} />
      <View style={styles.verticalScale}>
        <Text style={styles.axisLabel}>More assist</Text>
        <View style={styles.faderRow}>
          <LiquidFader value={value} color={color} onChange={onValue} height={166} />
          <StatusReadout number={value.toFixed(1)} word={levelWord(value)} color={color} />
        </View>
        <Text style={styles.axisLabel}>Less assist</Text>
      </View>
      <View style={styles.reactionHeader}>
        <Text style={styles.reactionTitle}>Reaction</Text>
        <Text style={[styles.reactionValue, { color }]}>{levelWord(reaction)}</Text>
      </View>
      <View style={styles.reactionDial}>
        <TuneDial
          value={reaction}
          min={0}
          max={10}
          step={0.5}
          unit="°/s"
          color={color}
          valueChangeMode="commit"
          onValueChange={onReaction}
        />
      </View>
    </View>
  )
}

function ControlIntro({
  icon: Icon,
  title,
  description,
  color,
  compact = false,
}: {
  icon: typeof LightningIcon
  title: string
  description: string
  color: string
  compact?: boolean
}) {
  return (
    <View style={styles.controlIntro}>
      <View style={styles.controlHead}>
        <Icon size={compact ? 16 : 19} color={color} weight="duotone" />
        <Text style={[styles.controlTitle, compact && styles.compactControlTitle]}>{title}</Text>
      </View>
      <Text style={[styles.controlIntroDescription, compact && styles.compactIntroDescription]}>
        {description}
      </Text>
    </View>
  )
}

function StatusReadout({ number, word, color }: { number: string; word: string; color: string }) {
  return (
    <View style={styles.statusReadout}>
      <Text style={[styles.statusNumber, { color }]}>{number}</Text>
      <Text style={[styles.level, { color }]}>{word}</Text>
    </View>
  )
}

function LiquidFader({
  value,
  color,
  onChange,
  height,
}: {
  value: number
  color: string
  onChange: (value: number) => void
  height: number
}) {
  const progress = useSharedValue(value)
  const dragging = useSharedValue(false)

  useEffect(() => {
    if (!dragging.value) {
      progress.value = value
    }
  }, [dragging, progress, value])

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin((event) => {
          dragging.value = true
          const next = Math.min(10, Math.max(0, (1 - event.y / height) * 10))
          progress.value = next
        })
        .onUpdate((event) => {
          const next = Math.min(10, Math.max(0, (1 - event.y / height) * 10))
          progress.value = next
        })
        .onFinalize(() => {
          dragging.value = false
          scheduleOnRN(onChange, Math.round(progress.value * 2) / 2)
        }),
    [dragging, height, onChange, progress],
  )
  const fillStyle = useAnimatedStyle(() => ({ height: (progress.value / 10) * height }))

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.liquidTrack, { height }]}>
        <Animated.View style={[styles.liquidFillClip, fillStyle]}>
          <Canvas style={[styles.liquidGradient, { height }]} pointerEvents="none">
            <RoundedRect x={0} y={0} width={58} height={height} r={29}>
              <LinearGradient
                start={vec(29, 0)}
                end={vec(29, height)}
                colors={[theme.alpha(color, 0.03), theme.alpha(color, 0.4)]}
              />
            </RoundedRect>
          </Canvas>
        </Animated.View>
        <View style={styles.liquidTicks} pointerEvents="none">
          {[1, 2, 3, 4].map((tick) => (
            <View key={tick} style={styles.liquidTick} />
          ))}
        </View>
      </Animated.View>
    </GestureDetector>
  )
}

function normalized(item: BasicSliderItem) {
  return item.value == null ? 0 : Math.round(((item.value - item.min) / (item.max - item.min)) * 10)
}
function controlDescription(id: string) {
  return (
    {
      aggressiveness: 'Strength of balance correction.',
      noseStiffness: 'Front support on acceleration.',
      tailStiffness: 'Rear support while braking.',
      carveTilt: 'Deck assistance while holding an edge.',
      brakeTilt: 'Nose lift during hard braking.',
    }[id] ?? 'Changes how the board responds under your feet.'
  )
}
function levelWord(value: number) {
  return value <= 0 ? 'Off' : value <= 3 ? 'Soft' : value <= 7 ? 'Medium' : 'Strong'
}
function findField(props: TuneVariantProps, id: string) {
  return props.displayGroups.flatMap((group) => group.fields).find((field) => field.id === id)
}
function fieldLevel(value: unknown, min = 0, max = 10) {
  return typeof value === 'number' && max != null && min != null && max > min
    ? Math.round(((value - min) / (max - min)) * 10)
    : 0
}
function setFieldLevel(
  field: ReturnType<typeof findField>,
  level: number,
  setter: TuneVariantProps['setDraftField'],
) {
  if (field && field.min != null && field.max != null)
    setter(field.id, field.min + (level / 10) * (field.max - field.min))
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 10 },
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  heroIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroCopy: { flex: 1, minWidth: 0 },
  title: { color: theme.palette.slate.textPrimary, fontSize: 20, fontWeight: '700' },
  subtitle: { color: theme.palette.slate.textMuted, fontSize: 12 },
  previewWrap: { position: 'relative', marginHorizontal: -16 },
  previewSelectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  previewSelect: {
    width: 86,
    height: 26,
    paddingHorizontal: 0,
    borderWidth: 0,
    backgroundColor: theme.alpha(theme.palette.slate.bg, 0),
  },
  previewSelectText: {
    color: theme.palette.slate.textSecondary,
    fontSize: 10,
    fontWeight: '800',
  },
  triple: { flexDirection: 'row', gap: 12, paddingTop: 4 },
  compact: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 7,
    paddingVertical: 4,
  },
  compactControlTitle: {
    fontSize: 10,
    lineHeight: 12,
  },
  compactIntroDescription: {
    minHeight: 38,
    paddingLeft: 24,
    fontSize: 9,
    lineHeight: 11,
  },
  level: { fontSize: 12, fontWeight: '800' },
  faderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  statusReadout: { minWidth: 38, gap: 2, alignItems: 'flex-start' },
  statusNumber: { fontFamily: theme.mono('700'), fontSize: 18 },
  liquidTrack: {
    width: 58,
    borderRadius: 29,
    borderWidth: 1.5,
    borderColor: theme.palette.slate.border,
    backgroundColor: theme.palette.slate.surface,
    overflow: 'hidden',
  },
  liquidFillClip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  liquidGradient: { position: 'absolute', left: 0, right: 0, bottom: 0, width: 58 },
  liquidTicks: {
    position: 'absolute',
    inset: 9,
    justifyContent: 'space-evenly',
  },
  liquidTick: {
    alignSelf: 'center',
    width: 12,
    height: 1,
    backgroundColor: theme.alpha(theme.palette.mono.white, 0.4),
  },
  dualControl: {
    flex: 1,
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  controlIntro: { alignSelf: 'stretch', gap: 5 },
  controlHead: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 8 },
  controlTitle: {
    flex: 1,
    color: theme.palette.slate.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  controlIntroDescription: {
    minHeight: 26,
    paddingLeft: 27,
    color: theme.palette.slate.textMuted,
    fontSize: 10,
    lineHeight: 12,
    textAlign: 'left',
  },
  verticalScale: { alignItems: 'center', gap: 6 },
  axisLabel: { color: theme.palette.slate.textMuted, fontSize: 9, fontWeight: '700' },
  controlDescription: {
    alignSelf: 'stretch',
    minHeight: 26,
    paddingHorizontal: 3,
    color: theme.palette.slate.textMuted,
    fontSize: 10,
    lineHeight: 12,
    textAlign: 'center',
  },
  split: { flexDirection: 'row', gap: 8 },
  reactionTitle: {
    color: theme.palette.slate.textMuted,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  reactionHeader: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    paddingTop: 4,
  },
  reactionValue: { fontSize: 10, fontWeight: '800' },
  reactionDial: { alignSelf: 'stretch', overflow: 'hidden' },
  modeRail: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    backgroundColor: theme.palette.slate.surfaceDeep,
    overflow: 'hidden',
  },
  modeButton: { flex: 1, alignItems: 'center', gap: 4, paddingTop: 10 },
  modeLabel: { color: theme.palette.slate.textMuted, fontSize: 9, fontWeight: '800' },
  modeMark: {
    width: 24,
    height: 2,
    borderRadius: 1,
    marginTop: 3,
    backgroundColor: theme.palette.slate.surfaceDeep,
  },
})
