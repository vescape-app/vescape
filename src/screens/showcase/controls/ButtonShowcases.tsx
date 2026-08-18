import { StyleSheet, View } from 'react-native'
import { useState } from 'react'
import {
  ArrowUpIcon,
  ArrowsClockwiseIcon,
  CameraIcon,
  HeartIcon,
  NavigationArrowIcon,
  PauseIcon,
  PencilSimpleIcon,
  RecordIcon,
  StopIcon,
  TrashIcon,
} from 'phosphor-react-native'

import { CircleButton } from '@/components/controls/CircleButton'
import {
  FloatingActionPill,
  FloatingBarFrame,
  FloatingStatusPill,
  type FloatingStatusPillModel,
} from '@/components/controls/FloatingBar'
import { PrevNextSelector } from '@/components/controls/PrevNextSelector'

import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow } from '@/components/dev/ShowcaseControls'
import { theme } from '@/constants/theme'

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

export function FloatingBarShowcase() {
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

const styles = StyleSheet.create({
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
})
