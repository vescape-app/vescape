import { ActivityIndicator, StyleSheet, View } from 'react-native'
import type { ReactNode } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'
import { Text } from '@/components/base/Text'
import type { Icon } from 'phosphor-react-native'

import { theme } from '@/constants/theme'

/**
 * State of one timeline step. Drives the glyph colour, connector colour, and
 * whether the step shows a spinner (`active`) or dims its text (`pending`/`absent`).
 */
export type StepState = 'done' | 'active' | 'pending' | 'failed' | 'absent'

export interface TimelineStep {
  /** Stable React key. */
  key: string
  icon: Icon
  label: string
  /** Optional subline — e.g. what the step is doing, or its result. */
  caption?: string
  /** Optional block under the caption — e.g. an inline picker or warning. */
  content?: ReactNode
  state: StepState
}

interface Props {
  steps: TimelineStep[]
  style?: StyleProp<ViewStyle>
  testID?: string
}

/**
 * A vertical checklist of steps connected by a rail. Each step is an outlined
 * glyph whose colour carries its state; the connector below a `done` step turns
 * green. Purely presentational — the caller owns the step list and updates states
 * as work progresses. Generic: no knowledge of what the steps represent.
 */
export function StepTimeline({ steps, style, testID }: Props) {
  return (
    <View style={[styles.timeline, style]} testID={testID}>
      {steps.map((step, i) => (
        <StepRow
          key={step.key}
          step={step}
          isLast={i === steps.length - 1}
          connectorDone={step.state === 'done'}
        />
      ))}
    </View>
  )
}

function StepRow({
  step,
  isLast,
  connectorDone,
}: {
  step: TimelineStep
  isLast: boolean
  connectorDone: boolean
}) {
  const dim = step.state === 'pending' || step.state === 'absent'
  return (
    <View style={styles.row}>
      <View style={styles.glyphCol}>
        <StepGlyph icon={step.icon} state={step.state} />
        {isLast ? null : (
          <View
            style={[
              styles.connector,
              {
                backgroundColor: connectorDone ? theme.palette.green.color : theme.neutral.border,
              },
            ]}
          />
        )}
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, dim && styles.rowLabelDim]} numberOfLines={1}>
          {step.label}
        </Text>
        {step.caption ? (
          <Text
            style={[styles.rowCaption, step.state === 'failed' && styles.rowCaptionError]}
            numberOfLines={1}
          >
            {step.caption}
          </Text>
        ) : null}
        {step.content ? <View style={styles.rowContent}>{step.content}</View> : null}
      </View>
    </View>
  )
}

/** Big thin-bordered outline circle — state lives in the border + icon colour, never a fill. */
function StepGlyph({ icon: StepIcon, state }: { icon: Icon; state: StepState }) {
  const color = GLYPH_COLOR[state]
  return (
    <View style={[styles.glyph, { borderColor: color }]}>
      {state === 'active' ? (
        <ActivityIndicator size="small" color={theme.status.upgrade.color} />
      ) : (
        <StepIcon size={22} color={color} weight="duotone" />
      )}
    </View>
  )
}

const GLYPH_COLOR: Record<StepState, string> = {
  done: theme.palette.green.color,
  active: theme.status.upgrade.color,
  failed: theme.status.error.color,
  pending: theme.neutral.border,
  absent: theme.neutral.border,
}

const styles = StyleSheet.create({
  timeline: {
    alignSelf: 'center',
    width: 300,
    maxWidth: '100%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 16,
  },
  glyphCol: {
    width: 44,
    alignItems: 'center',
  },
  connector: {
    width: 2,
    flex: 1,
    minHeight: 28,
    marginVertical: 4,
    borderRadius: 1,
  },
  glyph: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    color: theme.neutral.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  rowLabelDim: {
    color: theme.neutral.textMuted,
  },
  rowCaption: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  rowCaptionError: {
    color: theme.status.error.text,
  },
  rowContent: {
    marginTop: 6,
    marginBottom: 8,
  },
})
