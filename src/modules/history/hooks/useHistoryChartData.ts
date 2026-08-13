import { useMemo } from 'react'

import { computeAutoRangeFromValues, toExcludedRanges } from '@/components/charts/chartMath'
import type { ChartSpec } from '@/components/charts/line/ChartStack'
import { buildTimeline, type ChartTimeline } from '@/components/charts/line/timeline'
import type { ChartBand, ChartColorRamp, ChartSeriesData } from '@/components/charts/line/types'
import { theme } from '@/constants/theme'
import { telemetry } from '@/modules/board/constants/telemetry'
import {
  EXTRA_CHART_METRICS,
  HISTORY_CHART_DEFS,
  OPTIONAL_CHART_METRICS,
  SPEED_CHART_DEF,
  type ChartToggleMetric,
  type ExtraChartMetric,
} from '@/modules/history/components/historyChartMetrics'
import { toGpsGapRanges } from '@/modules/history/lib/gpsGaps'
import {
  getHistoryMetricColorRange,
  getTelemetrySampleMetricValue,
  type HistoryMetricKey,
  type MetricColorRange,
} from '@/modules/history/lib/metricColorScale'
import { RIDE_TRIM_PADDING_MS, rideMovingWindow } from '@/modules/history/lib/sessions'
import { useHistoryStore, type TelemetrySample } from '@/modules/history/store/historyStore'
import type { HistoryGpsSample } from 'vescape-core'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

const SPEED_CHART_HEIGHT = 48
const METRIC_CHART_HEIGHT = 40
/**
 * Excluded stretches sit on the floor of the plot, clear of the line they annotate; the GPS
 * dropouts of the whole ride get the row under them, at the foot of the stack.
 */
const EXCLUSION_ROW = 1
const GPS_GAP_ROW = 0
const FAVORITE_WASH = theme.alpha(theme.status.favorite.color, 0.12)

/** Every metric of a ride, plus derived pack percent. */
export type HistorySeries = Record<HistoryMetricKey | 'batteryPercent', ChartSeriesData>
export type HistoryRanges = Record<HistoryMetricKey, { min: number; max: number }>
export type HistoryRamps = Record<HistoryMetricKey, ChartColorRamp | undefined>

export function useVisibleRideSamples(
  samples: TelemetrySample[],
  movingStartAtMs: number | null,
  movingEndAtMs: number | null,
): TelemetrySample[] {
  const sortedSamples = useMemo(
    () => [...samples].sort((a, b) => a.capturedAtMs - b.capturedAtMs),
    [samples],
  )
  // Trim leading/trailing idle to the Moving Window (± display padding). Falls back to the full
  // sample range on legacy rides that have no precomputed window.
  const visibleSamples = useMemo(() => {
    const window = rideMovingWindow({ movingStartAtMs, movingEndAtMs })
    if (!window) return sortedSamples
    const lo = window.startMs - RIDE_TRIM_PADDING_MS
    const hi = window.endMs + RIDE_TRIM_PADDING_MS
    const trimmed = sortedSamples.filter((s) => s.capturedAtMs >= lo && s.capturedAtMs <= hi)
    return trimmed.length > 0 ? trimmed : sortedSamples
  }, [sortedSamples, movingStartAtMs, movingEndAtMs])
  return visibleSamples
}

/**
 * Every metric of a ride as parallel time/value arrays.
 *
 * Full resolution, deliberately: the chart builds its own level-of-detail pyramid and draws the
 * level that fits the zoom, so pre-decimating the ride to a few hundred points would only throw
 * away the detail a rider zooms in to find.
 */
export function useChartSeries(samples: TelemetrySample[]): HistorySeries {
  return useMemo(() => {
    const series = {} as HistorySeries
    for (const def of HISTORY_CHART_DEFS) series[def.key] = { ts: [], vs: [] }
    // Pack percent is derived from voltage rather than measured, so it is not a metric of its
    // own — but it is a line, and rides without a pack configured do not have it at all.
    series.batteryPercent = { ts: [], vs: [] }
    for (const sample of samples) {
      for (const def of HISTORY_CHART_DEFS) {
        const value = getTelemetrySampleMetricValue(sample, def.key)
        if (value == null) continue
        series[def.key].ts.push(sample.capturedAtMs)
        series[def.key].vs.push(value)
      }
      if (sample.batteryPercent == null) continue
      series.batteryPercent.ts.push(sample.capturedAtMs)
      series.batteryPercent.vs.push(sample.batteryPercent)
    }
    return series
  }, [samples])
}

/** Every chart-only metric of a ride — see {@link EXTRA_CHART_METRICS}. */
export type HistoryExtraSeries = Record<ExtraChartMetric, ChartSeriesData>
export type HistoryExtraRanges = Record<ExtraChartMetric, { min: number; max: number }>

function extraBoardValue(sample: TelemetrySample, metric: ExtraChartMetric): number | null {
  switch (metric) {
    case 'pitch':
      return sample.pitch
    case 'roll':
      return sample.roll
    case 'balancePitch':
      return sample.balancePitch
    case 'footpadAdc1':
      return sample.adc1
    case 'footpadAdc2':
      return sample.adc2
    default:
      return null
  }
}

function extraGpsValue(sample: HistoryGpsSample, metric: ExtraChartMetric): number | null {
  switch (metric) {
    case 'altitude':
      return sample.altitudeM
    case 'gpsAccuracy':
      return sample.accuracyM
    default:
      return null
  }
}

/**
 * The chart-only metrics of a ride, board stream and GPS log merged into one shape.
 *
 * The two sources are logged independently and at different rates, so they are read separately and
 * only meet here — the chart stack lines them up on the ride's own clock, not on a shared index.
 * Only the full-screen page calls this: the map panel never offers these metrics, and building
 * eight more series per ride under a map nobody asked to see would be wasted work.
 */
export function useExtraChartSeries(
  samples: TelemetrySample[],
  gpsSamples: HistoryGpsSample[],
): HistoryExtraSeries {
  return useMemo(() => {
    const series = {} as HistoryExtraSeries
    for (const def of EXTRA_CHART_METRICS) series[def.key] = { ts: [], vs: [] }

    for (const sample of samples) {
      for (const def of EXTRA_CHART_METRICS) {
        if (def.source !== 'board') continue
        const value = extraBoardValue(sample, def.key)
        if (value == null) continue
        series[def.key].ts.push(sample.capturedAtMs)
        series[def.key].vs.push(value)
      }
    }

    // Board samples define the visible ride; GPS logged outside it would stretch the x scale past
    // what every other chart shows.
    const startMs = samples.at(0)?.capturedAtMs ?? Number.NEGATIVE_INFINITY
    const endMs = samples.at(-1)?.capturedAtMs ?? Number.POSITIVE_INFINITY
    for (const sample of gpsSamples) {
      if (sample.capturedAtMs < startMs || sample.capturedAtMs > endMs) continue
      for (const def of EXTRA_CHART_METRICS) {
        if (def.source !== 'gps') continue
        const value = extraGpsValue(sample, def.key)
        if (value == null) continue
        series[def.key].ts.push(sample.capturedAtMs)
        series[def.key].vs.push(value)
      }
    }
    return series
  }, [gpsSamples, samples])
}

export function useExtraChartRanges(series: HistoryExtraSeries): HistoryExtraRanges {
  return useMemo(() => {
    const ranges = {} as HistoryExtraRanges
    for (const def of EXTRA_CHART_METRICS) {
      ranges[def.key] = computeAutoRangeFromValues(series[def.key].vs, def.range)
    }
    return ranges
  }, [series])
}

export function useChartRanges(series: HistorySeries): HistoryRanges {
  return useMemo(() => {
    const ranges = {} as HistoryRanges
    for (const def of HISTORY_CHART_DEFS) {
      ranges[def.key] = computeAutoRangeFromValues(series[def.key].vs, def.range)
    }
    return ranges
  }, [series])
}

/**
 * The hot-range gradient as a chart colour ramp.
 *
 * The old chart asked a `value => color` function per point and rebuilt a gradient stop for each
 * one, every frame. The two ends of the ramp say the same thing, and the chart turns them into a
 * single gradient it never has to touch again.
 */
function toColorRamp(range: MetricColorRange | null): ChartColorRamp | undefined {
  if (!range) return undefined
  return {
    stops: [
      { value: range.min, color: range.baseColor },
      { value: range.max, color: range.hotColor },
    ],
  }
}

export function useMetricRamps(): HistoryRamps {
  const gradientsEnabled = useSettingsStore((s) => s.historyMetricGradientsEnabled)
  const hotRanges = useSettingsStore((s) => s.historyMetricHotRanges)
  return useMemo(() => {
    const ramps = {} as HistoryRamps
    for (const def of HISTORY_CHART_DEFS) {
      ramps[def.key] = toColorRamp(
        getHistoryMetricColorRange(def.key, def.color, hotRanges, gradientsEnabled),
      )
    }
    return ramps
  }, [gradientsEnabled, hotRanges])
}

/** Free-spin stretches read as a fault; anything else excluded is merely not counted. */
function exclusionColor(reason: string): string {
  return reason === 'free_spin' ? theme.palette.yellow.color : theme.palette.slate.textSecondary
}

export function useChartExclusionBands() {
  const sessionExclusions = useHistoryStore((s) => s.sessionExclusions)
  return useMemo(() => {
    const bands = {} as Record<HistoryMetricKey, ChartBand[] | undefined>
    for (const def of HISTORY_CHART_DEFS) {
      bands[def.key] = def.statKeys
        ? toExcludedRanges(sessionExclusions, def.statKeys).map((range) => ({
            startMs: range.startMs,
            endMs: range.endMs,
            color: exclusionColor(range.reason),
            row: EXCLUSION_ROW,
          }))
        : undefined
    }
    return bands
  }, [sessionExclusions])
}

/**
 * Where the phone lost its fix, washed across the whole stack.
 *
 * The map has nothing to draw over these stretches while the charts stay full of board data, which
 * reads as if the ride went nowhere. A red mark under every line says the ride is fine and the
 * position is what is missing.
 */
export function useGpsGapBands(samples: TelemetrySample[]): ChartBand[] {
  const gpsSamples = useHistoryStore((s) => s.sessionGpsSamples)
  return useMemo(() => {
    const sampleTimes = samples.map((sample) => sample.capturedAtMs)
    return toGpsGapRanges(gpsSamples, sampleTimes).map((range) => ({
      ...range,
      color: theme.palette.red.color,
      row: GPS_GAP_ROW,
    }))
  }, [gpsSamples, samples])
}

/**
 * How long a ride has to stand still before the chart cuts the pause out, and what the cut is
 * worth on the axis once collapsed.
 *
 * Sessions already split on a 30-minute pause, so what is left inside one ride is a coffee stop or
 * a wait at lights — minutes of flat line that squeeze the riding either side of it into a corner.
 */
const GAP_MIN_MS = 5 * 60_000
const GAP_WIDTH_MS = 20_000

/** The ride's long pauses, or `null` when it has none — see {@link buildTimeline}. */
export function useChartTimeline(samples: TelemetrySample[]): ChartTimeline | null {
  return useMemo(
    () =>
      buildTimeline(
        samples.map((sample) => sample.capturedAtMs),
        { minGapMs: GAP_MIN_MS, gapWidthMs: GAP_WIDTH_MS },
      ),
    [samples],
  )
}

/**
 * Favourite stretches, washed across the whole stack.
 *
 * They belong to the ride rather than to a metric, so they are not one chart's band: the rider
 * marked a piece of the ride, and every line should show it.
 */
export function useFavoriteBands(ranges: { startMs: number; endMs: number }[]): ChartBand[] {
  return useMemo(
    () => ranges.map((range) => ({ ...range, color: FAVORITE_WASH, fill: 'plot' as const })),
    [ranges],
  )
}

interface HistoryChartStackInput {
  series: HistorySeries
  ranges: HistoryRanges
  ramps: HistoryRamps
  exclusionBands: Record<HistoryMetricKey, ChartBand[] | undefined>
  activeMetrics: ReadonlySet<ChartToggleMetric>
  /**
   * Let the rider close the speed chart too. The ride panel keeps speed as the line the stack is
   * read against; a page that is nothing but charts has no such anchor to protect.
   */
  speedOptional?: boolean
  /** Chart-only metrics, when the surface offers them — see {@link useExtraChartSeries}. */
  extraSeries?: HistoryExtraSeries
  extraRanges?: HistoryExtraRanges
  /** Chart heights, so a full screen can spend the room the map panel does not have. */
  speedHeight?: number
  metricHeight?: number
}

/**
 * The ride as one chart stack: speed always, plus whichever metrics the rider has opened.
 *
 * Built as a single list because the stack is the unit of synchronisation — every chart in it
 * shares one camera, one scrub cursor and one x scale, so metrics opened later line up with the
 * speed chart by construction rather than by matching props.
 */
export function useHistoryChartStack({
  series,
  ranges,
  ramps,
  exclusionBands,
  activeMetrics,
  extraSeries,
  extraRanges,
  speedOptional = false,
  speedHeight = SPEED_CHART_HEIGHT,
  metricHeight = METRIC_CHART_HEIGHT,
}: HistoryChartStackInput): ChartSpec[] {
  return useMemo(() => {
    const speed: ChartSpec = {
      key: 'speed',
      label: SPEED_CHART_DEF.label,
      height: speedHeight,
      series: [
        {
          key: 'speed',
          data: series.speed,
          color: SPEED_CHART_DEF.color,
          ramp: ramps.speed,
        },
      ],
      left: { range: ranges.speed },
      bands: exclusionBands.speed,
    }

    const optional = OPTIONAL_CHART_METRICS.filter((def) => activeMetrics.has(def.key)).map(
      (def) =>
        def.key === 'battery'
          ? batteryChart(series, ranges, ramps, metricHeight)
          : ({
              key: def.key,
              label: def.label,
              height: metricHeight,
              series: [
                { key: def.key, data: series[def.key], color: def.color, ramp: ramps[def.key] },
              ],
              left: { range: ranges[def.key] },
              bands: exclusionBands[def.key],
            } satisfies ChartSpec),
    )

    const extra =
      extraSeries && extraRanges
        ? EXTRA_CHART_METRICS.filter((def) => activeMetrics.has(def.key)).map(
            (def) =>
              ({
                key: def.key,
                label: def.label,
                height: metricHeight,
                series: [
                  {
                    key: def.key,
                    data: extraSeries[def.key],
                    color: def.color,
                    unit: def.unit,
                  },
                ],
                left: { range: extraRanges[def.key] },
              }) satisfies ChartSpec,
          )
        : []

    const showSpeed = !speedOptional || activeMetrics.has('speed')
    return [...(showSpeed ? [speed] : []), ...optional, ...extra]
  }, [
    activeMetrics,
    exclusionBands,
    extraRanges,
    extraSeries,
    metricHeight,
    ramps,
    ranges,
    series,
    speedHeight,
    speedOptional,
  ])
}

/**
 * Battery is two readings of one thing: pack percent against a fixed 0-100 scale, and pack
 * voltage on its own axis under it. Rides with no pack configured have no percent at all, and
 * fall back to voltage as the single line.
 */
function batteryChart(
  series: HistorySeries,
  ranges: HistoryRanges,
  ramps: HistoryRamps,
  height: number,
): ChartSpec {
  const hasPercent = series.batteryPercent.vs.length > 0
  const voltage: ChartSpec['series'][number] = {
    key: 'voltage',
    data: series.battery,
    color: telemetry.battVoltage.color,
    label: 'Pack',
    unit: telemetry.battVoltage.unit,
  }

  if (!hasPercent) {
    return {
      key: 'battery',
      label: 'Battery',
      height,
      series: [{ ...voltage, ramp: ramps.battery, label: undefined }],
      left: { range: ranges.battery },
    }
  }

  return {
    key: 'battery',
    label: 'Battery',
    height,
    series: [
      {
        key: 'percent',
        data: series.batteryPercent,
        color: telemetry.battVoltage.color,
        label: 'Charge',
        unit: '%',
      },
      { ...voltage, axis: 'right', color: theme.palette.slate.textMuted },
    ],
    left: { range: { min: 0, max: 100 } },
    right: { range: ranges.battery },
  }
}
