import { StyleSheet, View } from 'react-native'
import { useEffect, useState } from 'react'
import {
  ArrowUpIcon,
  ArrowsClockwiseIcon,
  BluetoothSlashIcon,
  BluetoothXIcon,
  CameraIcon,
  HeartIcon,
  NavigationArrowIcon,
  PauseIcon,
  PencilSimpleIcon,
  PlusCircleIcon,
  RecordIcon,
  StopIcon,
  TrashIcon,
  WarningCircleIcon,
  type Icon,
} from 'phosphor-react-native'

import { CircleButton } from '@/components/controls/CircleButton'
import { Text } from '@/components/base/Text'
import {
  FloatingActionPill,
  FloatingStatusPill,
  type FloatingStatusPillModel,
} from '@/components/controls/FloatingBar'
import { PrevNextSelector } from '@/components/controls/PrevNextSelector'
import { SegmentedToggle } from '@/components/controls/SegmentedToggle'

import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow } from '@/components/dev/ShowcaseControls'
import { theme } from '@/constants/theme'
import { useResolvedAccentColors } from '@/hooks/useTheme'
import { ActiveNavigationTopBar } from '@/screens/main/overlays/ActiveNavigationTopBar'

export function CircleButtonShowcase() {
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

const noop = () => undefined

function actionPill(
  text: string,
  status: 'warning' | 'error' | 'upgrade',
  icon: Icon,
): FloatingStatusPillModel {
  return {
    kind: 'action',
    icon,
    text,
    bg: theme.control.background,
    border: theme.status[status].border,
    textColor: theme.control.text,
    buttonBg: theme.status[status].color,
    onPress: noop,
  }
}

const BOARD_CONNECTION_PILLS: FloatingStatusPillModel[] = [
  actionPill('Add a new board', 'warning', PlusCircleIcon),
  actionPill('Link the board', 'warning', BluetoothSlashIcon),
  ...[
    'Searching…',
    'Discovering…',
    'Subscribing…',
    'Waiting for telemetry…',
    'Reconnecting…',
    'Disconnecting…',
    'Connecting…',
  ].map(
    (text): FloatingStatusPillModel => ({
      kind: 'spinner',
      text,
      color: theme.palette.sky.color,
      onPress: noop,
    }),
  ),
  actionPill('Update the board link', 'upgrade', ArrowsClockwiseIcon),
  actionPill('Re-link the board', 'upgrade', WarningCircleIcon),
  {
    kind: 'spinner',
    icon: WarningCircleIcon,
    text: 'Telemetry stale',
    color: theme.status.error.color,
    onPress: noop,
  },
  actionPill('Connect to the board', 'warning', BluetoothSlashIcon),
  actionPill('Retry connection', 'error', BluetoothXIcon),
]

const CONNECTION_DEMO_PILLS: FloatingStatusPillModel[] = [
  actionPill('Connect to the board', 'warning', BluetoothSlashIcon),
  ...['Searching…', 'Connecting…', 'Discovering…', 'Subscribing…', 'Waiting for telemetry…'].map(
    (text): FloatingStatusPillModel => ({
      kind: 'spinner',
      text,
      color: theme.palette.sky.color,
      onPress: noop,
    }),
  ),
]

export function NavigationTopBarShowcase() {
  const accents = useResolvedAccentColors()

  return (
    <ShowcaseCard name="Navigation top bar — reference">
      <View style={styles.navigationBarPreview}>
        <ActiveNavigationTopBar
          boardPill={
            <View style={styles.referenceBoardPill}>
              <View style={styles.referenceBoardStatus} />
              <Text style={styles.referenceBoardText}>Floatwheel ADV</Text>
            </View>
          }
          maxWidth={240}
          boardName="Floatwheel ADV"
          connected
          targetTitle="Forest trail entrance"
          targetIcon={NavigationArrowIcon}
          distanceLabel="1.2 km"
          riderColor={accents.violet.color}
          onNavigationPress={noop}
          onCancel={noop}
        />
      </View>
    </ShowcaseCard>
  )
}

export function FloatingBarShowcase() {
  const [demoStep, setDemoStep] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setDemoStep((step) => (step + 1) % CONNECTION_DEMO_PILLS.length)
    }, 1400)
    return () => clearInterval(interval)
  }, [])

  return (
    <>
      <ShowcaseCard name="Animated board connection">
        <View style={styles.connectionDemo}>
          <FloatingStatusPill pill={CONNECTION_DEMO_PILLS[demoStep]} />
        </View>
      </ShowcaseCard>
      <ShowcaseCard name="Board connection states">
        <View style={styles.statusPillList}>
          {BOARD_CONNECTION_PILLS.map((pill, index) => (
            <FloatingStatusPill key={`${pill.text}-${index}`} pill={pill} />
          ))}
        </View>
      </ShowcaseCard>
    </>
  )
}

export function FloatingActionPillShowcase() {
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

export function PrevNextSelectorShowcase() {
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

export function SegmentedToggleShowcase() {
  const [value, setValue] = useState<'total' | 'month'>('total')
  const [variant, setVariant] = useState<'control' | 'secondary'>('control')

  return (
    <ShowcaseCard name="SegmentedToggle">
      <ChipRow
        label="Surface"
        options={['control', 'secondary']}
        selected={variant}
        onSelect={(next) => setVariant(next as 'control' | 'secondary')}
      />
      <View style={styles.centeredPreview}>
        <SegmentedToggle
          options={[
            { value: 'total', label: 'All time' },
            { value: 'month', label: 'August 2026' },
          ]}
          value={value}
          onChange={setValue}
          variant={variant}
        />
      </View>
    </ShowcaseCard>
  )
}

const styles = StyleSheet.create({
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingVertical: 12,
  },
  statusPillList: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  connectionDemo: {
    height: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navigationBarPreview: {
    height: 78,
    alignItems: 'center',
    justifyContent: 'center',
  },
  referenceBoardPill: {
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: theme.control.border,
    backgroundColor: theme.control.background,
  },
  referenceBoardStatus: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: theme.status.success.color,
  },
  referenceBoardText: {
    color: theme.control.text,
    fontSize: 11,
    fontWeight: '800',
  },
  centeredPreview: {
    alignItems: 'center',
    paddingVertical: 12,
  },
})
