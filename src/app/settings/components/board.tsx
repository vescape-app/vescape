import { ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useState } from 'react'
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
import { InfoBadge } from '@/components/base/InfoBadge'
import { StepTimeline, type StepState, type TimelineStep } from '@/components/base/StepTimeline'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { DevBadge } from '@/components/dev/DevBadge'
import { BoardWarningRow } from '@/modules/board/components/BoardWarningRow'
import { ReplayBadge } from '@/modules/board/components/ReplayBadge'
import { ChipRow, ToggleRow } from '@/components/dev/ShowcaseControls'
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

function InfoBadgeShowcase() {
  return (
    <ShowcaseCard name="InfoBadge">
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <InfoBadge label="Motor temp" onPress={() => {}} />
        <InfoBadge label="Overcurrent" danger onPress={() => {}} />
      </View>
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

function DevBadgeShowcase() {
  return (
    <ShowcaseCard name="DevBadge">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <DevBadge />
        <Text style={{ color: theme.palette.slate.textPrimary, fontSize: 13 }}>
          Dev build marker · tap to hide for one minute
        </Text>
      </View>
    </ShowcaseCard>
  )
}

export default function BoardComponentsPage() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={LightningIcon}
          description="DeviceRow, InfoBadge, StepTimeline, BoardWarningRow, ReplayBadge, DevBadge — board- and connection-flavored components."
        />
        <DeviceRowShowcase />
        <InfoBadgeShowcase />
        <StepTimelineShowcase />
        <BoardWarningRowShowcase />
        <ReplayBadgeShowcase />
        <DevBadgeShowcase />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.palette.slate.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
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
