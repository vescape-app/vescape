import { ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useEffect, useState } from 'react'
import {
  CloudCheckIcon,
  DownloadSimpleIcon,
  LightningIcon,
  PackageIcon,
  PlugIcon,
} from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { IconHero } from '@/components/settings/IconHero'
import { DeviceRow } from '@/components/base/DeviceRow'
import { StepTimeline, type StepState, type TimelineStep } from '@/components/base/StepTimeline'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { BoardConfigSection } from '@/modules/board/components/BoardConfigSection'
import { BoardWarningRow } from '@/modules/board/components/BoardWarningRow'
import { ReplayBadge } from '@/modules/board/components/ReplayBadge'
import { TelemetryCell } from '@/modules/board/components/TelemetryCell'
import type { SparklinePoint } from '@/components/charts/Sparkline'
import { MOTOR_TEMP_CONFIG_ROWS } from '@/modules/board/constants/motorConfigRows'
import { telemetry } from '@/modules/board/constants/telemetry'
import { ChipRow, ToggleRow } from '@/components/dev/ShowcaseControls'
import { FootpadIndicatorShowcase } from '@/screens/showcase/board/FootpadIndicatorShowcase'
import { useSharedValue } from 'react-native-reanimated'
import { theme } from '@/constants/theme'

function DeviceRowShowcase() {
  const [rssi, setRssi] = useState('-65')

  return (
    <ShowcaseCard
      name="DeviceRow"
      controls={
        <ChipRow label="rssi" options={['-45', '-65', '-80']} selected={rssi} onSelect={setRssi} />
      }
    >
      <DeviceRow
        id="AA:BB:CC:DD:EE:FF"
        name="VESC Onewheel"
        rssi={Number(rssi)}
        onPress={() => {}}
      />
    </ShowcaseCard>
  )
}

const TIMELINE_ICONS = [PlugIcon, DownloadSimpleIcon, PackageIcon, CloudCheckIcon]
const TIMELINE_LABELS = ['Connect', 'Download', 'Install', 'Verify']
const TIMELINE_CAPTIONS = [
  'Opening the connection',
  'Fetching the payload',
  'Writing files to disk',
  'Checking the signature',
]

/** Build a 4-step list where everything before `reach` is done, the step at
 *  `reach` is active, and the rest pending. A negative `reach` fails the last
 *  done step instead, to show the error state. `content` demos the inline block
 *  slot under a done step's caption. */
function buildDemoSteps(reach: number, failed: boolean, content: boolean): TimelineStep[] {
  return TIMELINE_LABELS.map((label, i): TimelineStep => {
    let state: StepState = i < reach ? 'done' : i === reach ? 'active' : 'pending'
    if (failed && i === reach) state = 'failed'
    else if (failed && i > reach) state = 'absent'
    return {
      key: label,
      icon: TIMELINE_ICONS[i],
      label,
      caption: state === 'done' ? 'Done' : TIMELINE_CAPTIONS[i],
      content:
        content && state === 'done' && i === 0 ? (
          <View style={styles.timelineContentDemo}>
            <Text style={styles.timelineContentDemoText}>Inline step content</Text>
          </View>
        ) : undefined,
      state,
    }
  })
}

function StepTimelineShowcase() {
  const [reach, setReach] = useState('2')
  const [failed, setFailed] = useState(false)
  const [content, setContent] = useState(false)

  return (
    <ShowcaseCard
      name="StepTimeline"
      controls={
        <>
          <ChipRow
            label="reach"
            options={['0', '1', '2', '3', '4']}
            selected={reach}
            onSelect={setReach}
          />
          <ToggleRow label="failed" value={failed} onToggle={setFailed} />
          <ToggleRow label="content" value={content} onToggle={setContent} />
        </>
      }
    >
      <StepTimeline steps={buildDemoSteps(Number(reach), failed, content)} />
    </ShowcaseCard>
  )
}

function BoardWarningRowShowcase() {
  const [now] = useState(() => Date.now())
  const [dismissedKinds, setDismissedKinds] = useState<string[]>([])
  // One critical + one warn row, so both severity styles stay visible side by side.
  const warnings = [
    {
      boardId: 'demo',
      kind: 'cell-spread',
      severity: 'critical' as const,
      firstDetectedAtMs: now - 3 * 60 * 60 * 1000,
      lastDetectedAtMs: now - 90 * 1000,
      payloadJson: '{"peakSpread":0.27,"worstGroup":4,"balancing":true}',
    },
    {
      boardId: 'demo',
      kind: 'duty-pushback-high',
      severity: 'warn' as const,
      firstDetectedAtMs: now - 20 * 1000,
      lastDetectedAtMs: now - 20 * 1000,
      payloadJson: '{"param":"tiltback_duty","value":0.9,"bound":0.85}',
    },
  ]
  return (
    <ShowcaseCard
      name="BoardWarningRow"
      controls={
        <ToggleRow
          label="dismissed"
          value={dismissedKinds.length > 0}
          onToggle={(next) => setDismissedKinds(next ? ['cell-spread', 'duty-pushback-high'] : [])}
        />
      }
    >
      <View style={{ gap: 10 }}>
        {warnings.map((warning) => (
          <BoardWarningRow
            key={warning.kind}
            warning={warning}
            dismissed={dismissedKinds.includes(warning.kind)}
            onSetDismissed={(kind, value) =>
              setDismissedKinds((prev) =>
                value ? [...prev, kind] : prev.filter((k) => k !== kind),
              )
            }
          />
        ))}
      </View>
    </ShowcaseCard>
  )
}

function ReplayBadgeShowcase() {
  return (
    <ShowcaseCard name="ReplayBadge">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <ReplayBadge />
        <Text style={{ color: theme.palette.slate.textPrimary, fontSize: 13 }}>
          Funwheel · connection pill context
        </Text>
      </View>
    </ShowcaseCard>
  )
}

const DEMO_SERIES: SparklinePoint[] = Array.from({ length: 40 }, (_, i) => ({
  ts: Date.now() - (40 - i) * 1000,
  value: 34 + Math.sin(i / 4) * 8,
}))

function TelemetryCellShowcase() {
  const [live, setLive] = useState(false)
  const motorTemp = useSharedValue<number | null>(null)
  const motorCurrent = useSharedValue<number | null>(null)
  const battCurrent = useSharedValue<number | null>(null)

  useEffect(() => {
    motorTemp.value = live ? 42.3 : null
    motorCurrent.value = live ? 21.4 : null
    battCurrent.value = live ? 12.8 : null
  }, [live, motorTemp, motorCurrent, battCurrent])

  return (
    <ShowcaseCard
      name="TelemetryCell"
      controls={<ToggleRow label="board connected" value={live} onToggle={setLive} />}
    >
      <View style={styles.telemetryRow}>
        <TelemetryCell
          label="Motor"
          metric={telemetry.motorTemp}
          value={motorTemp}
          series={live ? DEMO_SERIES : []}
        />
        <TelemetryCell
          label="Motor"
          metric={telemetry.motorCurrent}
          value={motorCurrent}
          series={live ? DEMO_SERIES : []}
        />
        <TelemetryCell
          label="Batt"
          metric={telemetry.battCurrent}
          value={battCurrent}
          series={live ? DEMO_SERIES : []}
        />
      </View>
    </ShowcaseCard>
  )
}

const CONFIG_SECTION_VALUES = {
  freshness: 'fresh',
  values: { l_temp_motor_start: 80, l_temp_motor_end: 90 },
} as const

function BoardConfigSectionShowcase() {
  const [state, setState] = useState('fresh')

  return (
    <ShowcaseCard
      name="BoardConfigSection"
      controls={
        <ChipRow
          label="state"
          options={['fresh', 'last known', 'empty']}
          selected={state}
          onSelect={setState}
        />
      }
    >
      <BoardConfigSection
        title="Motor config"
        rows={MOTOR_TEMP_CONFIG_ROWS}
        values={
          state === 'empty'
            ? null
            : { ...CONFIG_SECTION_VALUES, freshness: state === 'fresh' ? 'fresh' : 'last-known' }
        }
        empty="No motor config read from this board yet. Connect it to read its cutoffs."
      />
    </ShowcaseCard>
  )
}

export default function BoardComponentsPage() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={LightningIcon}
          description="DeviceRow, StepTimeline, BoardWarningRow, ReplayBadge, TelemetryCell, BoardConfigSection — board- and connection-flavored components."
        />
        <DeviceRowShowcase />
        <StepTimelineShowcase />
        <BoardWarningRowShowcase />
        <ReplayBadgeShowcase />
        <TelemetryCellShowcase />
        <FootpadIndicatorShowcase />
        <BoardConfigSectionShowcase />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.palette.slate.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
  telemetryRow: { flexDirection: 'row', gap: 8, alignSelf: 'stretch' },
  timelineContentDemo: {
    backgroundColor: theme.palette.slate.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  timelineContentDemoText: {
    color: theme.palette.slate.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
})
