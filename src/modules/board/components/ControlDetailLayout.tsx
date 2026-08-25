import { useNavigation } from 'expo-router'
import { BellRingingIcon } from 'phosphor-react-native'
import { type ReactNode, useEffect, useMemo } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import type { SharedValue } from 'react-native-reanimated'
import { SectionHeader } from '@/components/base/SectionHeader'
import { Text } from '@/components/base/Text'

import { MetricAlerts } from '@/modules/alerts/components/MetricAlerts'
import {
  buildMetricAlertRuleSnapshot,
  getAlertThresholdValues,
} from '@/modules/alerts/lib/alertTest'
import { asAlertPresetMetric } from '@/modules/alerts/lib/alertPresets'
import { useBoardMetricAlerts } from '@/modules/alerts/hooks/useMetricAlerts'
import { theme } from '@/constants/theme'
import { MetricDetailAlertContext } from '@/modules/board/components/metricDetailAlertContext'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'
import {
  getHistoryMetricHotRange,
  getHistoryMetricKeyForControlId,
} from '@/modules/history/lib/metricColorScale'

interface Props {
  title: string
  children: ReactNode
  controlId?: string
  unit?: string
  /**
   * Live telemetry for the alert gauge. Preset metrics render their gauge inside the alerts block
   * (markers and levels are the same thing), so the value goes here rather than into `gauge`.
   */
  liveValue?: SharedValue<number | null>
  /** Gauge for controls without Alert Presets, rendered above the alerts block. */
  gauge?: ReactNode
}

/**
 * Shared chrome for a `/control/<metric>` detail screen: title, gauge, the control's alert setup,
 * and the screen's own charts. Every control gets the same alerts block — {@link MetricAlerts}
 * decides whether that means preset levels, the rider's own rules, or the no-board notice.
 */
export function ControlDetailLayout({
  title,
  children,
  controlId,
  unit = '',
  liveValue,
  gauge,
}: Props) {
  const navigation = useNavigation()
  useEffect(() => {
    navigation.setOptions({ title })
  }, [title, navigation])

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {controlId ? (
        <ControlDetailAlerts controlId={controlId} unit={unit} liveValue={liveValue} gauge={gauge}>
          {children}
        </ControlDetailAlerts>
      ) : (
        <>
          {gauge}
          {children}
        </>
      )}
    </ScrollView>
  )
}

/**
 * Bind one control's gauge, alert controls, and history chart to one immutable rule snapshot.
 * Alert controls stay directly below the main gauge; telemetry charts follow the complete block.
 */
function ControlDetailAlerts({
  controlId,
  unit,
  liveValue,
  gauge,
  children,
}: {
  controlId: string
  unit: string
  liveValue?: SharedValue<number | null>
  gauge?: ReactNode
  children: ReactNode
}) {
  const controller = useBoardMetricAlerts(controlId)
  const gradientsEnabled = useSettingsStore((s) => s.historyMetricGradientsEnabled)
  const hotRanges = useSettingsStore((s) => s.historyMetricHotRanges)

  const ruleSnapshot = useMemo(
    () =>
      controller
        ? buildMetricAlertRuleSnapshot({
            metric: controller.metric,
            level: controller.level,
            rules: controller.rules,
            boardTopSpeedKmh: controller.topSpeedKmh,
            hasBatteryConfig: controller.hasBatteryConfig,
          })
        : [],
    [controller],
  )
  const thresholds = useMemo(() => getAlertThresholdValues(ruleSnapshot), [ruleSnapshot])
  const alertContext = useMemo(() => ({ controlId, thresholds }), [controlId, thresholds])

  if (controlId === 'state') {
    return (
      <>
        {children}
        <View style={styles.alertsSection}>
          <AlertsHeader />
          <Text style={styles.stateNote}>Fault alerts are always active.</Text>
        </View>
      </>
    )
  }

  const hotMetric = getHistoryMetricKeyForControlId(controlId)
  const hotRange = hotMetric
    ? getHistoryMetricHotRange(hotMetric, hotRanges, gradientsEnabled)
    : null

  const alerts = (
    <MetricAlerts
      controller={controller}
      unit={unit}
      liveValue={liveValue}
      hotRange={hotRange}
      ruleSnapshot={ruleSnapshot}
    />
  )

  return (
    <MetricDetailAlertContext value={alertContext}>
      {asAlertPresetMetric(controlId) && controller ? (
        <>
          <MetricAlerts
            controller={controller}
            unit={unit}
            liveValue={liveValue}
            hotRange={hotRange}
            ruleSnapshot={ruleSnapshot}
            controlsHeader={<AlertsHeader />}
          />
          {children}
        </>
      ) : (
        <>
          {gauge}
          <View style={styles.alertsSection}>
            <AlertsHeader />
            {alerts}
          </View>
          {children}
        </>
      )}
    </MetricDetailAlertContext>
  )
}

function AlertsHeader() {
  return <SectionHeader icon={BellRingingIcon} color={theme.palette.yellow.color} title="Alerts" />
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.neutral.bg,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  alertsSection: {
    gap: 10,
    paddingTop: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  sectionLabel: {
    color: theme.neutral.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  stateNote: {
    color: theme.neutral.textDim,
    fontSize: 14,
  },
})
