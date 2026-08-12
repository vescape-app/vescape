// PROTOTYPE — throwaway. Variant H: tune through riding scenarios, not parameter groups.

import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  HandPalmIcon,
  LightningIcon,
  MountainsIcon,
  RocketLaunchIcon,
  WaveSineIcon,
} from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { applySliderValue, stepLabel } from '@/modules/tune/components/prototype/concerns'
import type { TuneVariantProps } from '@/modules/tune/components/prototype/types'
import type { BasicSliderItem } from '@/modules/tune/lib/sliderDefinitions'

export const VARIANT_H_NAME = 'Ride scenarios'

type Scenario = 'launch' | 'carve' | 'brake' | 'hills'

const SCENARIOS = [
  { id: 'launch', label: 'Launch', icon: RocketLaunchIcon, color: theme.palette.sky.color },
  { id: 'carve', label: 'Carve', icon: WaveSineIcon, color: theme.palette.pink.color },
  { id: 'brake', label: 'Brake', icon: HandPalmIcon, color: theme.palette.orange.color },
  { id: 'hills', label: 'Hills', icon: MountainsIcon, color: theme.palette.green.color },
] as const

const SCENARIO_COPY: Record<
  Scenario,
  { title: string; question: string; low: string; high: string }
> = {
  launch: {
    title: 'Acceleration',
    question: 'How should the board support your first push?',
    low: 'Loose & playful',
    high: 'Firm & immediate',
  },
  carve: {
    title: 'Cornering',
    question: 'How much should the deck help you hold an edge?',
    low: 'Natural lean',
    high: 'Deep carve assist',
  },
  brake: {
    title: 'Hard braking',
    question: 'How much support do you want under the front foot?',
    low: 'Smooth release',
    high: 'Strong nose lift',
  },
  hills: {
    title: 'Changing terrain',
    question: 'How much should the board adapt to the slope?',
    low: 'Mostly manual',
    high: 'Active assistance',
  },
}

export function VariantH(props: TuneVariantProps) {
  const insets = useSafeAreaInsets()
  const [scenario, setScenario] = useState<Scenario>('launch')
  const sliders = useMemo(
    () => new Map(props.basicSliders.map((item) => [item.id, item])),
    [props.basicSliders],
  )
  const active = SCENARIOS.find((item) => item.id === scenario) ?? SCENARIOS[0]

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 184 }]}
      >
        <View style={styles.heading}>
          <Text style={styles.kicker}>TUNE BY MOMENT</Text>
          <Text style={styles.title}>{SCENARIO_COPY[scenario].title}</Text>
          <Text style={styles.question}>{SCENARIO_COPY[scenario].question}</Text>
        </View>
        <ScenarioStage scenario={scenario} color={active.color} />
        <MomentSummary scenario={scenario} sliders={sliders} color={active.color} />
        <ScenarioControls
          scenario={scenario}
          sliders={sliders}
          setDraftField={props.setDraftField}
        />
      </ScrollView>

      <View style={[styles.scenarioRail, { bottom: insets.bottom + 154 }]}>
        {SCENARIOS.map((item) => {
          const Icon = item.icon
          const selected = scenario === item.id
          return (
            <Pressable
              key={item.id}
              style={[
                styles.scenarioButton,
                selected && {
                  borderColor: item.color,
                  backgroundColor: theme.alpha(item.color, 0.12),
                },
              ]}
              onPress={() => setScenario(item.id)}
            >
              <Icon
                size={20}
                color={selected ? item.color : theme.palette.slate.textMuted}
                weight="duotone"
              />
              <Text style={[styles.scenarioLabel, selected && { color: item.color }]}>
                {item.label}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

function ScenarioStage({ scenario, color }: { scenario: Scenario; color: string }) {
  const boardTransform =
    scenario === 'launch'
      ? '-5deg'
      : scenario === 'brake'
        ? '6deg'
        : scenario === 'carve'
          ? '-11deg'
          : '0deg'
  return (
    <View style={styles.stage}>
      {scenario === 'hills' ? (
        <>
          <View
            style={[
              styles.slope,
              {
                left: -18,
                transform: [{ rotate: '-12deg' }],
                borderColor: theme.palette.green.color,
              },
            ]}
          />
          <View
            style={[
              styles.slope,
              {
                right: -18,
                transform: [{ rotate: '12deg' }],
                borderColor: theme.palette.teal.color,
              },
            ]}
          />
        </>
      ) : (
        <View style={[styles.ground, scenario === 'carve' && styles.curve]} />
      )}
      <View
        style={[styles.board, { borderColor: color, transform: [{ rotate: boardTransform }] }]}
      />
      <View style={styles.wheel}>
        <View style={[styles.hub, { borderColor: color }]} />
      </View>
      {scenario !== 'hills' ? <View style={[styles.motion, { backgroundColor: color }]} /> : null}
    </View>
  )
}

function MomentSummary({
  scenario,
  sliders,
  color,
}: {
  scenario: Scenario
  sliders: Map<string, BasicSliderItem>
  color: string
}) {
  const relevant = scenarioIds(scenario)
    .map((id) => sliders.get(id))
    .filter((item): item is BasicSliderItem => item != null)
  const average =
    relevant.length === 0
      ? 0
      : relevant.reduce((sum, item) => sum + normalized(item), 0) / relevant.length
  const word =
    average <= 2 ? 'Natural' : average <= 5 ? 'Balanced' : average <= 8 ? 'Supported' : 'Locked in'
  return (
    <View style={styles.summary}>
      <View>
        <Text style={styles.summaryLabel}>Current feeling</Text>
        <Text style={[styles.summaryWord, { color }]}>{word}</Text>
      </View>
      <View style={styles.summaryBars}>
        {[2, 4, 6, 8, 10].map((mark) => (
          <View
            key={mark}
            style={[styles.summaryBar, mark <= average && { backgroundColor: color }]}
          />
        ))}
      </View>
    </View>
  )
}

function ScenarioControls({
  scenario,
  sliders,
  setDraftField,
}: {
  scenario: Scenario
  sliders: Map<string, BasicSliderItem>
  setDraftField: TuneVariantProps['setDraftField']
}) {
  const copy = SCENARIO_COPY[scenario]
  const ids = scenarioIds(scenario)
  return (
    <View style={styles.controls}>
      {ids.map((id, index) => {
        const item = sliders.get(id)
        if (!item) return null
        const color = controlColor(id)
        return (
          <MomentControl
            key={id}
            item={item}
            color={color}
            primary={index === 0}
            low={index === 0 ? copy.low : 'Less'}
            high={index === 0 ? copy.high : 'More'}
            onChange={(value) => applySliderValue(id, value, setDraftField)}
          />
        )
      })}
    </View>
  )
}

function MomentControl({
  item,
  color,
  primary,
  low,
  high,
  onChange,
}: {
  item: BasicSliderItem
  color: string
  primary: boolean
  low: string
  high: string
  onChange: (value: number) => void
}) {
  const value = normalized(item)
  return (
    <View style={[styles.control, primary && styles.controlPrimary]}>
      <View style={styles.controlHead}>
        {primary ? <LightningIcon size={18} color={color} weight="duotone" /> : null}
        <Text style={styles.controlLabel}>{friendlyLabel(item.id)}</Text>
        <Text style={[styles.controlWord, { color }]}>{stepLabel(item)}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.trackFill, { width: `${value * 10}%`, backgroundColor: color }]} />
        {[0, 2, 4, 6, 8, 10].map((mark) => (
          <Pressable
            key={mark}
            style={[styles.trackStep, { left: `${mark * 10}%` }]}
            hitSlop={8}
            onPress={() => onChange(item.min + (mark / 10) * (item.max - item.min))}
          >
            <View style={[styles.trackDot, mark <= value && { borderColor: color }]} />
          </Pressable>
        ))}
      </View>
      <View style={styles.ends}>
        <Text style={styles.endText}>{low}</Text>
        <Text style={styles.endText}>{high}</Text>
      </View>
    </View>
  )
}

function scenarioIds(scenario: Scenario): string[] {
  if (scenario === 'launch') return ['noseStiffness', 'aggressiveness']
  if (scenario === 'carve') return ['carveTilt', 'aggressiveness']
  if (scenario === 'brake') return ['brakeTilt', 'tailStiffness']
  return ['atrIntensity', 'noseStiffness', 'tailStiffness']
}
function friendlyLabel(id: string) {
  return (
    (
      {
        aggressiveness: 'Board response',
        noseStiffness: 'Front support',
        tailStiffness: 'Rear support',
        carveTilt: 'Edge assist',
        brakeTilt: 'Brake support',
        atrIntensity: 'Terrain assist',
      } as Record<string, string>
    )[id] ?? id
  )
}
function controlColor(id: string) {
  if (id === 'carveTilt') return theme.palette.pink.color
  if (id === 'brakeTilt' || id === 'tailStiffness') return theme.palette.orange.color
  if (id === 'atrIntensity') return theme.palette.green.color
  if (id === 'noseStiffness') return theme.palette.teal.color
  return theme.palette.sky.color
}
function normalized(item: BasicSliderItem) {
  return item.value == null ? 0 : Math.round(((item.value - item.min) / (item.max - item.min)) * 10)
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 18 },
  heading: { gap: 3 },
  kicker: {
    color: theme.palette.slate.textMuted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  title: { color: theme.palette.slate.textPrimary, fontSize: 24, fontWeight: '800' },
  question: { color: theme.palette.slate.textSecondary, fontSize: 12 },
  stage: { height: 180, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  ground: {
    position: 'absolute',
    left: -20,
    right: -20,
    bottom: 42,
    height: 1,
    backgroundColor: theme.palette.slate.border,
  },
  curve: {
    height: 80,
    bottom: 4,
    borderRadius: 120,
    borderBottomWidth: 1,
    borderBottomColor: theme.palette.pink.color,
    backgroundColor: theme.palette.slate.bg,
  },
  slope: { position: 'absolute', bottom: 28, width: 220, height: 70, borderTopWidth: 1.5 },
  board: { width: 178, height: 8, borderRadius: 5, borderWidth: 1.5, zIndex: 2 },
  wheel: {
    position: 'absolute',
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    borderColor: theme.palette.slate.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hub: { width: 22, height: 22, borderRadius: 11, borderWidth: 1 },
  motion: { position: 'absolute', left: 42, top: 58, width: 56, height: 1 },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: theme.palette.slate.border,
  },
  summaryLabel: { color: theme.palette.slate.textMuted, fontSize: 10, fontWeight: '700' },
  summaryWord: { fontSize: 20, fontWeight: '900' },
  summaryBars: { width: 100, flexDirection: 'row', gap: 4 },
  summaryBar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.palette.slate.surfaceDeep,
  },
  controls: { gap: 12 },
  control: { gap: 13, paddingVertical: 10 },
  controlPrimary: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    backgroundColor: theme.palette.slate.surface,
  },
  controlHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  controlLabel: {
    flex: 1,
    color: theme.palette.slate.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  controlWord: { fontSize: 12, fontWeight: '900' },
  track: {
    height: 22,
    justifyContent: 'center',
    borderBottomWidth: 3,
    borderBottomColor: theme.palette.slate.surfaceDeep,
  },
  trackFill: { position: 'absolute', left: 0, bottom: -3, height: 3 },
  trackStep: {
    position: 'absolute',
    bottom: -8,
    width: 16,
    height: 16,
    marginLeft: -8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: theme.palette.slate.border,
    backgroundColor: theme.palette.slate.bg,
  },
  ends: { flexDirection: 'row', justifyContent: 'space-between' },
  endText: { color: theme.palette.slate.textMuted, fontSize: 9 },
  scenarioRail: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', gap: 5 },
  scenarioButton: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 9,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    backgroundColor: theme.palette.slate.surfaceDeep,
  },
  scenarioLabel: { color: theme.palette.slate.textMuted, fontSize: 9, fontWeight: '800' },
})
