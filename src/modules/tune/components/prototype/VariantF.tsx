// PROTOTYPE — throwaway. Variant F: four rider-facing modes with a bottom icon rail.

import { useDeferredValue, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useSharedValue } from 'react-native-reanimated'
import type { TuneProfileFieldValue } from 'vescape-core'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  GaugeIcon,
  HandPalmIcon,
  LightningIcon,
  MountainsIcon,
  QuestionIcon,
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
import {
  VariantFLiquidFader,
  type FaderReadout,
} from '@/modules/tune/components/prototype/VariantFLiquidFader'
import {
  type ResponseScenario,
  VariantFResponsePreview,
} from '@/modules/tune/components/prototype/VariantFResponsePreview'

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

const PREVIEW_PRESET_OPTIONS: SelectOption<PreviewPresetId>[] = Object.entries(PREVIEW_PRESETS)
  .map(([value, preset]) => ({ value: value as PreviewPresetId, label: preset.label }))
  .filter((option) => option.value !== 'flat')

export function VariantF(props: TuneVariantProps) {
  const insets = useSafeAreaInsets()
  const [mode, setMode] = useState<Mode>('response')
  const [presetId, setPresetId] = useState<PreviewPresetId>('small')
  const [responseScenario, setResponseScenario] = useState<ResponseScenario>('acceleration')
  const [responseLegendHelpVisible, setResponseLegendHelpVisible] = useState(false)
  const [styleScenario, setStyleScenario] = useState<ResponseScenario>('acceleration')
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
  const deferredPreviewFields = useDeferredValue(previewFields)

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom:
              insets.bottom + (mode === 'overview' ? 360 : mode === 'terrain' ? 230 : 170),
          },
        ]}
      >
        <ModeHero
          mode={mode}
          presetId={presetId}
          onPresetChange={setPresetId}
          onResponseLegendHelp={() => setResponseLegendHelpVisible(true)}
        />
        {mode === 'overview' ? null : mode === 'response' ? (
          <VariantFResponsePreview
            fields={deferredPreviewFields}
            scenario={responseScenario}
            aggressiveness={normalized(sliders.get('aggressiveness'))}
            stiffness={normalized(
              sliders.get(responseScenario === 'acceleration' ? 'noseStiffness' : 'tailStiffness'),
            )}
            onScenarioChange={setResponseScenario}
          />
        ) : mode === 'style' ? (
          <VariantFResponsePreview
            fields={deferredPreviewFields}
            scenario={styleScenario}
            aggressiveness={normalized(sliders.get('aggressiveness'))}
            stiffness={0}
            cycling
            onScenarioChange={setStyleScenario}
          />
        ) : (
          <PreviewPanel fields={deferredPreviewFields} presetId={presetId} />
        )}
        {mode === 'response' ? (
          <ResponsePage
            sliders={sliders}
            setDraftField={props.setDraftField}
            onScenarioChange={setResponseScenario}
          />
        ) : null}
        {mode === 'style' ? (
          <StylePage sliders={sliders} setDraftField={props.setDraftField} />
        ) : null}
        {mode === 'terrain' ? <TerrainPage props={props} /> : null}
        {mode === 'overview' ? <VariantFOverview sliders={sliders} props={props} /> : null}
      </ScrollView>

      <InfoModal
        visible={responseLegendHelpVisible}
        title="Board and Target"
        message={
          'Board is the solid blue line. It shows how the deck is actually tilted in this preview.\n\nTarget is the dashed purple line. It shows the angle the controller is trying to reach.\n\nWhen the lines are apart, the board is still reacting. Aggressiveness changes how firmly and quickly Board follows Target. Nose and Tail stiffness move Target when the motor is working or braking.'
        }
        onDismiss={() => setResponseLegendHelpVisible(false)}
      />

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
  onScenarioChange,
}: {
  sliders: Map<string, BasicSliderItem>
  setDraftField: TuneVariantProps['setDraftField']
  onScenarioChange: (scenario: ResponseScenario) => void
}) {
  const items = ['noseStiffness', 'aggressiveness', 'tailStiffness']
    .map((id) => sliders.get(id))
    .filter((item): item is BasicSliderItem => item != null)
  return (
    <View style={styles.triple}>
      {items.map((item, index) => (
        <CompactControl
          key={item.id}
          item={item}
          icon={
            item.id === 'aggressiveness'
              ? LightningIcon
              : item.id === 'noseStiffness'
                ? ArrowUpIcon
                : ArrowDownIcon
          }
          color={
            item.id === 'aggressiveness'
              ? theme.palette.sky.color
              : item.id === 'noseStiffness'
                ? theme.palette.teal.color
                : theme.palette.orange.color
          }
          onInteraction={() => {
            if (item.id === 'noseStiffness') onScenarioChange('acceleration')
            if (item.id === 'tailStiffness') onScenarioChange('braking')
          }}
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
  const tiltbackSpeed = findField(props, 'atr_on_speed')
  const releaseSpeed = findField(props, 'atr_off_speed')
  const reactionSpeeds = [tiltbackSpeed?.value, releaseSpeed?.value].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  )
  const reactionSpeed =
    reactionSpeeds.length > 0
      ? reactionSpeeds.reduce((total, value) => total + value, 0) / reactionSpeeds.length
      : 0
  return (
    <>
      <View style={styles.split}>
        <AtrColumn
          title="Climb assist"
          icon={ArrowUpIcon}
          color={theme.palette.green.color}
          value={fieldLevel(up?.value, 0, 2)}
          onValue={(value) => up && props.setDraftField(up.id, value / 5)}
        />
        <AtrColumn
          title="Descent assist"
          icon={ArrowDownIcon}
          color={theme.palette.teal.color}
          value={fieldLevel(down?.value, 0, 2)}
          onValue={(value) => down && props.setDraftField(down.id, value / 5)}
        />
      </View>
      <View style={styles.atrReaction}>
        <View style={styles.reactionHeader}>
          <Text style={styles.reactionTitle}>ATR reaction speed</Text>
          <Text style={[styles.reactionValue, { color: theme.palette.green.color }]}>
            {reactionSpeed.toFixed(0)} deg/s
          </Text>
        </View>
        <View style={styles.reactionDial}>
          <TuneDial
            value={reactionSpeed}
            min={0}
            max={200}
            step={5}
            unit="deg/s"
            color={theme.palette.green.color}
            valueChangeMode="commit"
            onValueChange={(value) => {
              if (tiltbackSpeed) props.setDraftField(tiltbackSpeed.id, value)
              if (releaseSpeed) props.setDraftField(releaseSpeed.id, value)
            }}
          />
        </View>
      </View>
    </>
  )
}

function ModeHero({
  mode,
  presetId,
  onPresetChange,
  onResponseLegendHelp,
}: {
  mode: Mode
  presetId: PreviewPresetId
  onPresetChange: (preset: PreviewPresetId) => void
  onResponseLegendHelp: () => void
}) {
  const content = {
    response: [
      'Board response',
      'How firmly the board holds you',
      theme.palette.sky.color,
      LightningIcon,
    ],
    style: [
      'Ride character',
      'Carving and braking, tuned separately',
      theme.palette.pink.color,
      WaveSineIcon,
    ],
    terrain: [
      'Terrain assist',
      'Independent help uphill and downhill',
      theme.palette.green.color,
      MountainsIcon,
    ],
    overview: ['Tune overview', 'One glance before saving', theme.palette.purple.color, GaugeIcon],
  }[mode] as [string, string, string, typeof LightningIcon]
  const HeroIcon = content[3]
  return (
    <View style={styles.hero}>
      <View style={styles.heroIdentity}>
        <HeroIcon size={20} color={content[2]} weight="duotone" />
        <View style={styles.heroCopy}>
          <Text style={styles.title}>{content[0]}</Text>
          <Text style={styles.subtitle}>{content[1]}</Text>
        </View>
      </View>
      <View style={styles.previewSelectRow}>
        {mode === 'response' ? (
          <>
            <View style={styles.boardLegendSwatch} />
            <Text style={styles.boardLegendLabel}>Board</Text>
            <View style={styles.targetLegendSwatch} />
            <Text style={styles.targetLegendLabel}>Target</Text>
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="What Board and Target mean"
              onPress={onResponseLegendHelp}
            >
              <QuestionIcon size={14} color={theme.palette.slate.textMuted} weight="bold" />
            </Pressable>
          </>
        ) : mode === 'style' ? null : mode === 'terrain' ? (
          <>
            <MountainsIcon size={13} color={theme.palette.green.color} weight="duotone" />
            <Select
              options={PREVIEW_PRESET_OPTIONS}
              value={presetId}
              onChange={onPresetChange}
              style={styles.previewSelect}
              textStyle={styles.previewSelectText}
            />
          </>
        ) : (
          <>
            <MountainsIcon size={13} color={theme.palette.green.color} weight="duotone" />
            <Text style={styles.previewSelectText}>Flat</Text>
          </>
        )}
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
          lockedSpeedKmh={15}
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
  onInteraction,
  onValue,
}: {
  item: BasicSliderItem
  icon: typeof LightningIcon
  color: string
  onInteraction?: () => void
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
      <VariantFLiquidFader
        value={normalized(item)}
        color={color}
        height={160}
        readouts={sliderReadouts(item)}
        onInteraction={onInteraction}
        onChange={(level) => onValue(item.min + (level / 10) * (item.max - item.min))}
      />
    </View>
  )
}

function WideControl({
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
    <View style={styles.dualControl}>
      <ControlIntro
        icon={Icon}
        title={item.label}
        description={controlDescription(item.id)}
        color={color}
      />
      <VariantFLiquidFader
        value={normalized(item)}
        color={color}
        height={166}
        readouts={sliderReadouts(item)}
        wide
        onChange={(level) => onValue(item.min + (level / 10) * (item.max - item.min))}
      />
    </View>
  )
}

function AtrColumn({
  title,
  icon: Icon,
  color,
  value,
  onValue,
}: {
  title: string
  icon: typeof LightningIcon
  color: string
  value: number
  onValue: (value: number) => void
}) {
  const description =
    title === 'Climb assist'
      ? 'Lifts the nose as the terrain rises.'
      : 'Keeps the board composed on descents.'

  return (
    <View style={styles.dualControl}>
      <ControlIntro icon={Icon} title={title} description={description} color={color} />
      <VariantFLiquidFader
        value={value}
        color={color}
        height={166}
        readouts={levelReadouts()}
        wide
        onChange={onValue}
      />
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

function normalized(item: BasicSliderItem | undefined) {
  return item?.value == null
    ? 0
    : Math.round(((item.value - item.min) / (item.max - item.min)) * 10)
}

function sliderReadouts(item: BasicSliderItem): FaderReadout[] {
  return Array.from({ length: 21 }, (_, index) => {
    const value = item.min + (index / 20) * (item.max - item.min)
    const preview = { ...item, value, modifiedManually: false }
    return { number: formatSliderValue(preview), word: stepLabel(preview) }
  })
}

function levelReadouts(): FaderReadout[] {
  return Array.from({ length: 21 }, (_, index) => {
    const value = index / 2
    return { number: value.toFixed(1), word: levelWord(value) }
  })
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
    width: 112,
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
  boardLegendSwatch: { width: 14, height: 2, backgroundColor: theme.palette.sky.color },
  targetLegendSwatch: {
    width: 14,
    height: 1,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.palette.purple.light,
  },
  boardLegendLabel: { color: theme.palette.sky.color, fontSize: 9, fontWeight: '800' },
  targetLegendLabel: { color: theme.palette.purple.light, fontSize: 9, fontWeight: '800' },
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
  atrReaction: { gap: 4, paddingTop: 8 },
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
