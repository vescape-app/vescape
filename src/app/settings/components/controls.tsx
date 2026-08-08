import { ScrollView, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useEffect, useMemo, useState } from 'react'
import {
  cancelAnimation,
  Easing,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import {
  ArrowUpIcon,
  ArrowsClockwiseIcon,
  BriefcaseIcon,
  CameraIcon,
  CloudSunIcon,
  FadersIcon,
  GaugeIcon,
  HeartIcon,
  HouseIcon,
  LightningIcon,
  MapPinIcon,
  MapTrifoldIcon,
  NavigationArrowIcon,
  PauseIcon,
  PencilSimpleIcon,
  RecordIcon,
  SpeedometerIcon,
  StopIcon,
  SwatchesIcon,
  SlidersHorizontalIcon,
  TrashIcon,
  WrenchIcon,
} from 'phosphor-react-native'

import { ALERT_BEEP_COUNT_DEFAULT } from 'vescape-core'
import { IconHero } from '@/components/settings/IconHero'
import { CircleButton } from '@/components/controls/CircleButton'
import {
  FloatingActionPill,
  FloatingBarFrame,
  FloatingStatusPill,
  type FloatingStatusPillModel,
} from '@/components/controls/FloatingBar'
import { PrevNextSelector } from '@/components/controls/PrevNextSelector'
import {
  PillSelectorItem,
  PillSelectorAdd,
  PillSelectorDot,
  PillSelectorMenuItem,
  PillSelector,
} from '@/components/controls/PillSelector'
import { MapOptionSelector } from '@/components/controls/MapOptionSelector'
import { AlertPresetControl } from '@/modules/alerts/components/AlertPresetControl'
import { buildAlertTestRules } from '@/modules/alerts/lib/alertTest'
import type { AlertPresetLevel, AlertPresetMetric } from '@/modules/alerts/lib/alertPresets'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, ToggleRow } from '@/components/dev/ShowcaseControls'
import { theme } from '@/constants/theme'

function ZonePillsShowcase() {
  const [selectedId, setSelectedId] = useState('home')
  const [wideSelectedId, setWideSelectedId] = useState('trail')
  const [regularScrollId, setRegularScrollId] = useState('home')
  const [tunePresetId, setTunePresetId] = useState('street')
  const [mapModeId, setMapModeId] = useState('legalLimits')
  const iconOptions = [
    { id: 'trail', label: 'Trail', icon: MapPinIcon, color: theme.palette.violet },
    { id: 'street', label: 'Street', icon: NavigationArrowIcon, color: theme.palette.sky },
    { id: 'boost', label: 'Boost', icon: LightningIcon, color: theme.palette.amber },
    { id: 'camera', label: 'Camera', icon: CameraIcon, color: theme.palette.purple },
    { id: 'favorites', label: 'Favorites', icon: HeartIcon, color: theme.palette.red },
  ]
  const regularScrollOptions = [
    { id: 'home', label: 'Home', icon: HouseIcon, color: theme.palette.green },
    { id: 'work', label: 'Work', icon: BriefcaseIcon, color: theme.palette.sky },
    { id: 'gym', label: 'Gym', icon: LightningIcon, color: theme.palette.amber },
    { id: 'parents', label: 'Parents', icon: HeartIcon, color: theme.palette.red },
    { id: 'garage', label: 'Garage', icon: WrenchIcon, color: theme.palette.orange },
    { id: 'trailhead', label: 'Trailhead', icon: MapPinIcon, color: theme.palette.violet },
  ]
  const tunePresetOptions = [
    { id: 'street', label: 'Street', icon: SlidersHorizontalIcon, color: theme.palette.sky },
    { id: 'trail', label: 'Trail', icon: MapPinIcon, color: theme.palette.violet },
    { id: 'race', label: 'Race', icon: GaugeIcon, color: theme.palette.red },
    { id: 'commute', label: 'Commute', icon: BriefcaseIcon, color: theme.palette.green },
    { id: 'flow', label: 'Flow', icon: FadersIcon, color: theme.palette.purple },
    { id: 'torque', label: 'Torque', icon: LightningIcon, color: theme.palette.amber },
  ]
  const renderIconOptions = (includeAdd = false) => (
    <PillSelector activeId={wideSelectedId}>
      {iconOptions.map((option) => (
        <PillSelectorItem
          key={option.id}
          id={option.id}
          label={option.label}
          icon={option.icon}
          color={option.color}
          onPress={() => setWideSelectedId(option.id)}
        />
      ))}
      {includeAdd ? <PillSelectorAdd onPress={() => undefined} /> : null}
    </PillSelector>
  )

  return (
    <ShowcaseCard name="PillSelector">
      <View style={styles.selectorVariants}>
        <View style={styles.selectorVariant}>
          <Text style={styles.selectorCaption}>
            icons, status dots, add button, long-press menu
          </Text>
          <PillSelector activeId={selectedId}>
            <PillSelectorItem
              id="home"
              label="Home"
              icon={HouseIcon}
              labelBehavior="always"
              badge={<PillSelectorDot status="enabled" />}
              color={theme.palette.green}
              onPress={() => setSelectedId('home')}
            >
              <PillSelectorMenuItem
                icon={TrashIcon}
                label="Delete"
                onPress={() => undefined}
                danger
              />
            </PillSelectorItem>
            <PillSelectorItem
              id="work"
              label="Work"
              icon={BriefcaseIcon}
              labelBehavior="always"
              badge={<PillSelectorDot status="disabled" />}
              color={theme.palette.green}
              onPress={() => setSelectedId('work')}
            >
              <PillSelectorMenuItem
                icon={TrashIcon}
                label="Delete"
                onPress={() => undefined}
                danger
              />
            </PillSelectorItem>
            <PillSelectorItem
              id="custom"
              label="Custom"
              labelBehavior="always"
              badge={<PillSelectorDot status="draft" />}
              color={theme.palette.green}
              onPress={() => setSelectedId('custom')}
            >
              <PillSelectorMenuItem
                icon={PencilSimpleIcon}
                label="Rename"
                onPress={() => undefined}
              />
              <PillSelectorMenuItem
                icon={TrashIcon}
                label="Delete"
                onPress={() => undefined}
                danger
                separator
              />
            </PillSelectorItem>
            <PillSelectorAdd onPress={() => undefined} />
          </PillSelector>
        </View>

        <View style={styles.selectorVariant}>
          <Text style={styles.selectorCaption}>mixed active colors and icon-only differences</Text>
          {renderIconOptions()}
        </View>

        <View style={styles.selectorVariant}>
          <Text style={styles.selectorCaption}>constrained width, horizontal scroll</Text>
          <View style={styles.narrowPreview}>{renderIconOptions(true)}</View>
        </View>

        <View style={styles.selectorVariant}>
          <Text style={styles.selectorCaption}>regular labels, six items, horizontal scroll</Text>
          <View style={styles.narrowPreviewWide}>
            <PillSelector activeId={regularScrollId}>
              {regularScrollOptions.map((option) => (
                <PillSelectorItem
                  key={option.id}
                  id={option.id}
                  label={option.label}
                  icon={option.icon}
                  labelBehavior="always"
                  color={option.color}
                  onPress={() => setRegularScrollId(option.id)}
                />
              ))}
              <PillSelectorAdd onPress={() => undefined} />
            </PillSelector>
          </View>
        </View>

        <View style={styles.selectorVariant}>
          <Text style={styles.selectorCaption}>
            tune presets, default collapsing labels, add button
          </Text>
          <View style={styles.narrowPreviewWide}>
            <PillSelector activeId={tunePresetId} contained>
              {tunePresetOptions.map((option) => (
                <PillSelectorItem
                  key={option.id}
                  id={option.id}
                  label={option.label}
                  icon={option.icon}
                  color={option.color}
                  activeWidth={118}
                  onPress={() => setTunePresetId(option.id)}
                />
              ))}
              <PillSelectorAdd onPress={() => undefined} />
            </PillSelector>
          </View>
        </View>

        <View style={styles.selectorVariant}>
          <Text style={styles.selectorCaption}>map mode tabs, active label only</Text>
          <PillSelector activeId={mapModeId} contained fitContent style={styles.mapModeTabsPreview}>
            <PillSelectorItem
              id="map"
              label="Explore"
              icon={MapTrifoldIcon}
              activeLabelOnly
              color={theme.palette.violet}
              activeWidth={116}
              onPress={() => setMapModeId('map')}
            />
            <PillSelectorItem
              id="weather"
              label="Weather"
              icon={CloudSunIcon}
              activeLabelOnly
              color={theme.palette.sky}
              activeWidth={142}
              inactiveWidth={58}
              hint={<Text style={styles.mapModeHint}>23°</Text>}
              hintVisibility="inactive"
              hintGap={2}
              onPress={() => setMapModeId('weather')}
            />
            <PillSelectorItem
              id="legalLimits"
              label="Legal limits"
              icon={SpeedometerIcon}
              activeLabelOnly
              color={theme.palette.green}
              activeWidth={136}
              inactiveWidth={44}
              onPress={() => setMapModeId('legalLimits')}
            />
          </PillSelector>
        </View>
      </View>
    </ShowcaseCard>
  )
}

function CircleButtonShowcase() {
  return (
    <ShowcaseCard name="CircleButton">
      <View style={styles.buttonRow}>
        <CircleButton icon={PencilSimpleIcon} accessibilityLabel="Edit" onPress={() => undefined} />
        <CircleButton
          icon={TrashIcon}
          accessibilityLabel="Delete"
          variant="outline"
          onPress={() => undefined}
        />
        <CircleButton
          icon={ArrowUpIcon}
          accessibilityLabel="Move up"
          variant="ghost"
          onPress={() => undefined}
        />
        <CircleButton
          icon={ArrowsClockwiseIcon}
          accessibilityLabel="Loading"
          loading
          onPress={() => undefined}
        />
        <CircleButton
          icon={NavigationArrowIcon}
          accessibilityLabel="Disabled"
          disabled
          onPress={() => undefined}
        />
      </View>
      <View style={styles.buttonRow}>
        <CircleButton
          icon={CameraIcon}
          accessibilityLabel="Add photo"
          tone="purple"
          size="xs"
          onPress={() => undefined}
        />
        <CircleButton
          icon={HeartIcon}
          accessibilityLabel="Favorite"
          tone="amber"
          size="sm"
          variant="soft"
          onPress={() => undefined}
        />
        <CircleButton
          icon={RecordIcon}
          accessibilityLabel="Record"
          tone="red"
          size="md"
          variant="outline"
          onPress={() => undefined}
        />
        <CircleButton
          icon={StopIcon}
          accessibilityLabel="Stop recording"
          tone="red"
          size="lg"
          variant="solid"
          onPress={() => undefined}
        />
      </View>
    </ShowcaseCard>
  )
}

function FloatingBarShowcase() {
  const [kind, setKind] = useState<'spinner' | 'action'>('spinner')

  const pill: FloatingStatusPillModel =
    kind === 'spinner'
      ? {
          kind: 'spinner',
          text: 'Searching...',
          color: theme.palette.sky.color,
          onPress: () => undefined,
        }
      : {
          kind: 'action',
          text: 'Board not connected',
          buttonText: 'Connect',
          bg: theme.status.warning.bg,
          border: theme.status.warning.border,
          textColor: theme.status.warning.text,
          buttonBg: theme.status.warning.color,
          onPress: () => undefined,
        }

  return (
    <ShowcaseCard
      name="FloatingBar"
      controls={
        <ChipRow
          label="state"
          options={['spinner', 'action']}
          selected={kind}
          onSelect={(v) => setKind(v as typeof kind)}
        />
      }
    >
      <View style={styles.floatingPreview}>
        <FloatingBarFrame bottomOffset={18}>
          <FloatingStatusPill pill={pill} />
        </FloatingBarFrame>
      </View>
    </ShowcaseCard>
  )
}

function FloatingActionPillShowcase() {
  const [state, setState] = useState<'REC' | 'STOP' | 'PAUSED'>('REC')
  const recording = state !== 'REC'
  const paused = state === 'PAUSED'

  return (
    <ShowcaseCard
      name="FloatingActionPill"
      controls={
        <ChipRow
          label="state"
          options={['REC', 'STOP', 'PAUSED']}
          selected={state}
          onSelect={(v) => setState(v as typeof state)}
        />
      }
    >
      <View style={styles.centeredPreview}>
        <FloatingActionPill
          icon={recording ? (paused ? PauseIcon : StopIcon) : RecordIcon}
          label={state}
          active={recording}
          paused={paused}
          onPress={() => undefined}
        />
      </View>
    </ShowcaseCard>
  )
}

function PrevNextSelectorShowcase() {
  const [index, setIndex] = useState(1)
  const labels = ['Ride 08:12', 'Ride 12:47', 'Ride 18:05']

  return (
    <ShowcaseCard name="PrevNextSelector">
      <View style={styles.centeredPreview}>
        <PrevNextSelector
          label={labels[index]}
          previousDisabled={index === 0}
          nextDisabled={index === labels.length - 1}
          onPrevious={() => setIndex((v) => Math.max(0, v - 1))}
          onNext={() => setIndex((v) => Math.min(labels.length - 1, v + 1))}
          onSelect={() => undefined}
        />
      </View>
    </ShowcaseCard>
  )
}

function MapOptionSelectorShowcase() {
  const [expanded, setExpanded] = useState(false)
  const [active, setActive] = useState('north')

  const options = useMemo(
    () => [
      {
        key: 'north',
        label: 'North',
        icon: (
          <ArrowUpIcon
            size={20}
            color={active === 'north' ? theme.palette.green.text : theme.palette.slate.textDim}
            weight="bold"
          />
        ),
      },
      {
        key: 'gps',
        label: 'GPS',
        icon: (
          <NavigationArrowIcon
            size={20}
            color={active === 'gps' ? theme.palette.green.text : theme.palette.slate.textDim}
            weight="fill"
          />
        ),
      },
      {
        key: 'free',
        label: 'Free',
        icon: (
          <ArrowsClockwiseIcon
            size={20}
            color={active === 'free' ? theme.palette.green.text : theme.palette.slate.textDim}
            weight="bold"
          />
        ),
      },
    ],
    [active],
  )

  const activeIcon = useMemo(() => {
    if (active === 'north')
      return <ArrowUpIcon size={21} color={theme.palette.green.text} weight="bold" />
    if (active === 'gps')
      return <NavigationArrowIcon size={21} color={theme.palette.green.text} weight="fill" />
    return <ArrowsClockwiseIcon size={21} color={theme.palette.green.text} weight="bold" />
  }, [active])

  return (
    <ShowcaseCard
      name="MapOptionSelector"
      controls={
        <ChipRow
          label="mode"
          options={['north', 'gps', 'free']}
          selected={active}
          onSelect={(v) => {
            setActive(v)
            setExpanded(false)
          }}
        />
      }
    >
      <View style={{ alignItems: 'center', paddingVertical: 12 }}>
        <MapOptionSelector
          activeKey={active}
          activeIcon={activeIcon}
          activeColor={theme.palette.green.text}
          activeBackground={theme.palette.green.bg}
          collapsedAccessibilityLabel="Navigation mode"
          expanded={expanded}
          options={options}
          onToggle={() => setExpanded((p) => !p)}
          onSelect={(k) => {
            setActive(k)
            setExpanded(false)
          }}
        />
      </View>
    </ShowcaseCard>
  )
}

const PRESET_METRICS: AlertPresetMetric[] = [
  'speed',
  'duty',
  'battery',
  'motor-temp',
  'controller-temp',
]

// Full-scale per metric, matching AlertPresetControl's gauge — drives the demo needle sweep.
const PRESET_DEMO_MAX: Record<AlertPresetMetric, number> = {
  speed: 50,
  duty: 100,
  battery: 100,
  'motor-temp': 80,
  'controller-temp': 80,
}

// A couple of custom (non-preset) markers so the showcase demonstrates preset + custom layering.
const PRESET_DEMO_CUSTOM_ALERTS: Record<AlertPresetMetric, { id: string; threshold: number }[]> = {
  speed: [{ id: 'demo-speed', threshold: 45 }],
  duty: [{ id: 'demo-duty', threshold: 92 }],
  battery: [{ id: 'demo-battery', threshold: 10 }],
  'motor-temp': [{ id: 'demo-motor', threshold: 78 }],
  'controller-temp': [{ id: 'demo-controller', threshold: 78 }],
}

function AlertPresetControlShowcase() {
  const [metric, setMetric] = useState<AlertPresetMetric>('speed')
  const [level, setLevel] = useState<AlertPresetLevel>('normal')
  const [live, setLive] = useState(false)
  const [custom, setCustom] = useState(false)
  const [editable, setEditable] = useState(true)
  const [disabled, setDisabled] = useState(false)
  const liveValue = useSharedValue<number | null>(null)
  const testRules = useMemo(
    () =>
      buildAlertTestRules({
        metric,
        level,
        boardTopSpeedKmh: 50,
        hasBatteryConfig: true,
        customRules:
          level === 'custom'
            ? PRESET_DEMO_CUSTOM_ALERTS[metric].map((rule) => ({
                ...rule,
                controlId: metric,
                thresholdMax: null,
                enabled: true,
                soundType: metric === 'speed' || metric === 'duty' ? 'preset:tick' : 'preset:beep',
                repeatEverySeconds: null,
                beepCount: ALERT_BEEP_COUNT_DEFAULT,
                createdAt: 0,
              }))
            : [],
      }),
    [level, metric],
  )

  useEffect(() => {
    if (!live) {
      liveValue.value = null
      return
    }
    liveValue.value = 0
    liveValue.value = withRepeat(
      withTiming(PRESET_DEMO_MAX[metric], { duration: 2200, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    )
    return () => cancelAnimation(liveValue)
  }, [live, metric, liveValue])

  return (
    <ShowcaseCard
      name="AlertPresetControl"
      controls={
        <>
          <ChipRow
            label="metric"
            options={PRESET_METRICS}
            selected={metric}
            onSelect={(v) => setMetric(v as AlertPresetMetric)}
          />
          <ToggleRow label="live session" value={live} onToggle={setLive} />
          <ToggleRow label="custom markers" value={custom} onToggle={setCustom} />
          <ToggleRow label="editable" value={editable} onToggle={setEditable} />
          <ToggleRow label="disabled" value={disabled} onToggle={setDisabled} />
        </>
      }
    >
      <AlertPresetControl
        metric={metric}
        level={level}
        onLevelChange={setLevel}
        liveValue={live ? liveValue : undefined}
        boardTopSpeedKmh={50}
        hasBatteryConfig
        customAlerts={
          custom
            ? PRESET_DEMO_CUSTOM_ALERTS[metric].map((a) => ({ ...a, thresholdMax: null }))
            : undefined
        }
        disabled={disabled}
        testRules={testRules}
        onCustomize={editable ? () => setLevel('custom') : undefined}
        onDiscardCustom={editable ? () => setLevel('normal') : undefined}
      />
    </ShowcaseCard>
  )
}

export default function ControlsPage() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={SwatchesIcon}
          description="CircleButton, FloatingBar, PrevNextSelector, PillSelector, MapOptionSelector, AlertPresetControl."
        />
        <AlertPresetControlShowcase />
        <CircleButtonShowcase />
        <FloatingBarShowcase />
        <FloatingActionPillShowcase />
        <PrevNextSelectorShowcase />
        <ZonePillsShowcase />
        <MapOptionSelectorShowcase />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.palette.slate.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingVertical: 12,
  },
  floatingPreview: {
    height: 150,
    position: 'relative',
  },
  centeredPreview: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  selectorVariants: {
    gap: 18,
    paddingVertical: 8,
  },
  selectorVariant: {
    gap: 8,
  },
  selectorCaption: {
    color: theme.palette.slate.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  narrowPreview: {
    width: 220,
    alignSelf: 'center',
    overflow: 'hidden',
    paddingVertical: 10,
  },
  narrowPreviewWide: {
    width: 260,
    alignSelf: 'center',
    overflow: 'hidden',
    paddingVertical: 10,
  },
  mapModeTabsPreview: {
    alignSelf: 'center',
  },
  mapModeHint: {
    color: theme.palette.sky.color,
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
})
