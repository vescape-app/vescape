import { useMemo } from 'react'
import { View } from 'react-native'
import type { SharedValue } from 'react-native-reanimated'

import { ChartLoadingOverlay } from '@/components/charts/ChartLoadingOverlay'
import { TelemetryLineChart } from '@/components/charts/TelemetryLineChart'
import type {
  ExcludedRange,
  TelemetryChartPoint,
  TelemetryChartRange,
} from '@/components/charts/chartMath'
import type { TelemetryMetricConfig } from '@/modules/board/constants/telemetry'
import { useMetricDetailAlertThresholds } from '@/modules/board/components/metricDetailAlertContext'
import { FOCUS_DEFER_MS } from '@/modules/board/hooks/useLiveMetric'
import { useBleStore } from '@/modules/board/store/bleStore'
import { useDeferredMount } from '@/hooks/useDeferredMount'
import { DASH } from '@/helpers/format'

interface SecondaryMetricSeries {
  points: TelemetryChartPoint[]
  range: TelemetryChartRange
  color: string
  formatValue: (value: number) => string
}

interface MetricDetailChartProps {
  metric: TelemetryMetricConfig
  points: TelemetryChartPoint[]
  range: TelemetryChartRange
  windowMs: number
  height?: number
  formatValue?: (value: number) => string
  label?: string
  excludedRanges?: ExcludedRange[]
  secondary?: SecondaryMetricSeries
  /** Shared cursor: pass the same SharedValue to several charts to scrub them in lockstep. */
  scrubTimeMs?: SharedValue<number | null>
  onScrubTimeChange?: (timeMs: number) => void
  /** Reserve the right-axis gutter so this chart lines up with a sibling that has a secondary axis. */
  reserveRightAxis?: boolean
}

function valueAtTime(points: TelemetryChartPoint[], timeMs: number): TelemetryChartPoint | null {
  if (points.length === 0) return null
  let best = points[0]
  let bestDistance = Math.abs(best.date.getTime() - timeMs)
  for (const point of points) {
    const distance = Math.abs(point.date.getTime() - timeMs)
    if (distance < bestDistance) {
      best = point
      bestDistance = distance
    }
  }
  return best
}

export function MetricDetailChart({
  metric,
  points,
  range,
  windowMs,
  height = 120,
  formatValue = metric.formatWithUnit,
  label,
  excludedRanges,
  secondary,
  scrubTimeMs,
  onScrubTimeChange,
  reserveRightAxis,
}: MetricDetailChartProps) {
  const alertThresholds = useMetricDetailAlertThresholds(metric.controlId)
  // The series is opened on the same deferral (see `useLiveMetric`), so until it lands the chart
  // renders its chrome with no points and says so. Only a connected board will ever fill it —
  // without one an empty chart is the honest end state, not a pending one.
  const ready = useDeferredMount(FOCUS_DEFER_MS)
  const connected = useBleStore((s) => s.status === 'connected')
  const loading = connected && (!ready || points.length === 0)
  // Live charts never persist a selection: while scrubbing the marker follows the
  // cursor, on release it snaps back to the newest point to signal "live".
  const currentPoint = points.at(-1) ?? null
  const displayValue = currentPoint ? formatValue(currentPoint.value) : DASH

  const secondarySeries = useMemo(() => {
    if (!secondary || secondary.points.length === 0) return undefined
    const at = currentPoint
      ? valueAtTime(secondary.points, currentPoint.date.getTime())
      : (secondary.points.at(-1) ?? null)
    return {
      points: secondary.points,
      range: secondary.range,
      color: secondary.color,
      value: at ? secondary.formatValue(at.value) : DASH,
      formatValue: secondary.formatValue,
    }
  }, [secondary, currentPoint])

  return (
    <View>
      <TelemetryLineChart
        label={label}
        value={displayValue}
        points={points}
        currentPoint={currentPoint}
        color={metric.color}
        range={range}
        height={height}
        scrubbable
        formatValue={formatValue}
        windowMs={windowMs}
        excludedRanges={excludedRanges}
        secondary={secondarySeries}
        scrubTimeMs={scrubTimeMs}
        onScrubTimeChange={onScrubTimeChange}
        reserveRightAxis={reserveRightAxis}
        alertThresholds={alertThresholds}
      />
      {loading ? <ChartLoadingOverlay /> : null}
    </View>
  )
}
