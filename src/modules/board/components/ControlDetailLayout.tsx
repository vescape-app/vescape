import { useNavigation } from 'expo-router'
import { BellRingingIcon } from 'phosphor-react-native'
import { type ReactNode, useEffect, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import type { SharedValue } from 'react-native-reanimated'
import { PageScrollView } from '@/components/base/PageScrollView'
import { SectionHeader } from '@/components/base/SectionHeader'
import { Text } from '@/components/base/Text'

import { MetricAlerts } from '@/modules/alerts/components/MetricAlerts'
import { getAlertThresholdValues } from '@/modules/alerts/lib/alertTest'
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
  liveValue?: SharedValue<number | null>
  gauge?: ReactNode
}

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
    <PageScrollView style={styles.container} contentContainerStyle={styles.content}>
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
    </PageScrollView>
  )
}

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

  const thresholds = useMemo(
    () => getAlertThresholdValues(controller?.ruleSnapshot ?? []),
    [controller?.ruleSnapshot],
  )
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
    <MetricAlerts controller={controller} unit={unit} liveValue={liveValue} hotRange={hotRange} />
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
