import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import type { SharedValue } from 'react-native-reanimated'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { AlertPresetControl } from '@/modules/alerts/components/AlertPresetControl'
import { AlertRuleList } from '@/modules/alerts/components/AlertRuleList'
import type { MetricAlertsController } from '@/modules/alerts/hooks/useMetricAlerts'

/** Structural mirror of the gauge hot-range span; keeps this module clear of the history module. */
interface MetricAlertsHotRange {
  start: number
  end: number
}

interface MetricAlertsProps {
  controller: MetricAlertsController | null
  unit: string
  /** Live telemetry value driving the gauge needle; absent renders the offline preview. */
  liveValue?: SharedValue<number | null>
  hotRange?: MetricAlertsHotRange | null
  /** Detail-screen Alerts heading, placed directly below the gauge. */
  controlsHeader?: ReactNode
}

/**
 * A control's whole alert setup: preset level with its gauge, then the rider's own rules and
 * **+ Add alert**. Both fire together. One block, used by `/control` details and by the add-board
 * wizard through their respective {@link MetricAlertsController}s.
 *
 * A `null` controller means no Board: Alert Rules are board-owned (#254), so instead of controls
 * that would silently write nowhere, the block explains that and offers the way forward.
 */
export function MetricAlerts({
  controller,
  unit,
  liveValue,
  hotRange,
  controlsHeader,
}: MetricAlertsProps) {
  if (!controller) return <NoBoardNotice />

  const { metric, level, hasBatteryConfig } = controller
  // Battery presets are SoC %-based — a hard block, not a prompt, without a valid battery config.
  const batteryBlocked = metric === 'battery' && !hasBatteryConfig

  return (
    <View style={styles.container}>
      {metric && level ? (
        <AlertPresetControl
          metric={metric}
          level={level}
          onLevelChange={controller.setLevel}
          liveValue={liveValue}
          boardTopSpeedKmh={controller.topSpeedKmh}
          matchBoardConfig={controller.matchBoardConfig}
          onMatchBoardConfigChange={controller.setMatchBoardConfig}
          geigerSound={controller.geigerSound}
          onGeigerSoundChange={controller.setGeigerSound}
          configBases={controller.configBases}
          hotRange={hotRange}
          levelDisabled={batteryBlocked}
          // Without a config, battery rider rules are volts and cannot sit on the % gauge.
          ruleSnapshot={batteryBlocked ? controller.presetRules : controller.ruleSnapshot}
          presetRules={controller.presetRules}
          controlsHeader={controlsHeader}
        />
      ) : null}

      {controller.presetError ? <Text style={styles.error}>{controller.presetError}</Text> : null}

      {batteryBlocked ? (
        <Text style={styles.note}>
          Battery presets need a valid battery configuration — they alert on state-of-charge %. Set
          up this board&apos;s battery to enable them.
        </Text>
      ) : null}

      <View style={styles.rules}>
        <AlertRuleList
          controller={controller}
          unit={unit}
          batteryConfig={controller.batteryConfig}
        />
      </View>
    </View>
  )
}

/** The section header already carries the alert bell and the screen its own add-board path, so
 * this is the sentence alone — no second icon, no competing call to action. */
function NoBoardNotice() {
  return (
    <Text style={styles.note}>
      Alerts belong to a board — add yours to set up what it warns you about.
    </Text>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  rules: {
    gap: 8,
  },
  error: {
    color: theme.status.error.text,
    fontSize: 12,
    lineHeight: 16,
  },
  note: {
    color: theme.neutral.textMuted,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
})
