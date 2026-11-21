import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import type { SharedValue } from 'react-native-reanimated'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import {
  AlertPresetControl,
  type PresetGaugeHotRange,
} from '@/modules/alerts/components/AlertPresetControl'
import { AlertRuleList } from '@/modules/alerts/components/AlertRuleList'
import type { MetricAlertsController } from '@/modules/alerts/hooks/useMetricAlerts'

interface MetricAlertsProps {
  controller: MetricAlertsController | null
  unit: string
  liveValue?: SharedValue<number | null>
  hotRange?: PresetGaugeHotRange | null
  controlsHeader?: ReactNode
}

export function MetricAlerts({
  controller,
  unit,
  liveValue,
  hotRange,
  controlsHeader,
}: MetricAlertsProps) {
  if (!controller) return <NoBoardNotice />

  const { metric, level, hasBatteryConfig } = controller
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
        <Text style={styles.heading}>CUSTOM ALERTS</Text>
        <AlertRuleList
          controller={controller}
          unit={unit}
          batteryConfig={controller.batteryConfig}
        />
      </View>
    </View>
  )
}

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
  heading: {
    color: theme.neutral.textMuted,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
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
