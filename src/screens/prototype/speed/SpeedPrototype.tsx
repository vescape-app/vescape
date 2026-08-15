/**
 * PROTOTYPE — five redesigns of `/control/speed`, switchable with `?variant=`.
 * Question: how should the speed detail screen look, given the double header, the boring gauge,
 * the buried alerts, and the thrown-in chart. Variant `0` is today's screen, for comparison.
 * Throwaway — delete this folder once a direction wins.
 */
import { useEffect, useMemo } from 'react'
import { useLocalSearchParams, useNavigation } from 'expo-router'

import { MetricDetailAlertContext } from '@/modules/board/components/metricDetailAlertContext'
import { toTelemetryChartPoints } from '@/modules/board/components/metricDetailData'
import {
  liveSelectors,
  useLiveExcludedRanges,
  useLiveMetric,
} from '@/modules/board/hooks/useLiveMetric'
import { liveTelemetryRuntime } from '@/modules/board/lib/liveTelemetryRuntime'
import { useBoardMetricAlerts } from '@/modules/alerts/hooks/useMetricAlerts'
import {
  buildMetricAlertRuleSnapshot,
  getAlertThresholdValues,
} from '@/modules/alerts/lib/alertTest'
import { useLiveWindowMs } from '@/modules/settings/store/settingsStore'

import { PrototypeSwitcher } from './PrototypeSwitcher'
import { SPEED, useMockLiveValue, type VariantProps } from './kit'
import { mockSpeedPoints } from './mock'
import { VariantA } from './variants/VariantA'
import { VariantB } from './variants/VariantB'
import { VariantC } from './variants/VariantC'
import { VariantD } from './variants/VariantD'
import { VariantE } from './variants/VariantE'
import { VariantF } from './variants/VariantF'
import { VariantG } from './variants/VariantG'
import { VariantH } from './variants/VariantH'
import { VariantI } from './variants/VariantI'
import { VariantJ } from './variants/VariantJ'

const VARIANTS: { key: string; name: string; render: (props: VariantProps) => React.ReactNode }[] =
  [
    { key: 'A', name: 'Speed tape', render: (p) => <VariantA {...p} /> },
    { key: 'B', name: 'One ladder', render: (p) => <VariantB {...p} /> },
    { key: 'C', name: 'Bento', render: (p) => <VariantC {...p} /> },
    { key: 'D', name: 'Heads-up', render: (p) => <VariantD {...p} /> },
    { key: 'E', name: 'Fused instrument', render: (p) => <VariantE {...p} /> },
    { key: 'F', name: 'Headroom', render: (p) => <VariantF {...p} /> },
    { key: 'G', name: 'Speed envelope', render: (p) => <VariantG {...p} /> },
    { key: 'H', name: 'Ride tape', render: (p) => <VariantH {...p} /> },
    { key: 'I', name: 'Pack & cells', render: (p) => <VariantI {...p} /> },
    { key: 'J', name: 'Ride card', render: (p) => <VariantJ {...p} /> },
  ]

export function SpeedPrototype() {
  const params = useLocalSearchParams<{ variant?: string }>()
  const navigation = useNavigation()
  const key = (params.variant ?? 'A').toUpperCase()
  const current = VARIANTS.find((v) => v.key === key) ?? VARIANTS[0]!

  // Every variant draws its own header — killing the double header is half the point.
  useEffect(() => {
    navigation.setOptions({ headerShown: false })
    return () => navigation.setOptions({ headerShown: true })
  }, [navigation])

  const controller = useBoardMetricAlerts('speed')
  const speed = useLiveMetric(liveSelectors.speed)
  const windowMs = useLiveWindowMs()
  // Prototype scenery: with no board connected the live series is empty, which makes every
  // variant look broken. Fall back to a synthetic ride so the layouts can be judged (and shot).
  const live = useMemo(() => toTelemetryChartPoints(speed), [speed])
  const points = useMemo(
    () => (live.length > 0 ? live : mockSpeedPoints(windowMs)),
    [live, windowMs],
  )
  const excludedRanges = useLiveExcludedRanges('avg_speed', 'max_speed')
  const usingMock = live.length === 0
  const mockLive = useMockLiveValue(usingMock)

  const thresholds = useMemo(() => {
    const snapshot = controller
      ? buildMetricAlertRuleSnapshot({
          metric: controller.metric,
          level: controller.level,
          rules: controller.rules,
          boardTopSpeedKmh: controller.topSpeedKmh,
          hasBatteryConfig: controller.hasBatteryConfig,
        })
      : []
    return getAlertThresholdValues(snapshot)
  }, [controller])
  const alertContext = useMemo(
    () => ({ controlId: SPEED.controlId ?? 'speed', thresholds }),
    [thresholds],
  )

  const props: VariantProps = {
    controller,
    live: usingMock ? mockLive : liveTelemetryRuntime.values.speedKmh,
    points,
    windowMs,
    excludedRanges,
  }

  return (
    <MetricDetailAlertContext value={alertContext}>
      {current.render(props)}
      <PrototypeSwitcher
        variants={VARIANTS.map((v) => ({ key: v.key, name: v.name }))}
        current={current.key}
      />
    </MetricDetailAlertContext>
  )
}
