import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Easing, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'

import { ChartLineUpIcon } from 'phosphor-react-native'
import { LinearGauge } from '@/components/charts/LinearGauge'
import { IconHero } from '@/components/settings/IconHero'
import { ChartLoadingOverlay } from '@/components/charts/ChartLoadingOverlay'
import { ChartStackShowcase } from '@/components/charts/line/ChartStackShowcase'
import { ChartStack } from '@/components/charts/line/ChartStack'
import { computeAutoRangeFromValues } from '@/components/charts/chartMath'
import type { ChartSeriesData } from '@/components/charts/line/types'
import { SingleGauge } from '@/modules/board/components/SingleGauge'
import { DualGauge } from '@/modules/board/components/DualGauge'
import { Sparkline, type SparklinePoint } from '@/components/charts/Sparkline'
import { BmsCellVoltagesView } from '@/modules/battery/components/BmsCellVoltages'
import { summarizeBms, summarizeBmsWindow } from '@/modules/battery/lib'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, ToggleRow } from '@/components/dev/ShowcaseControls'
import { theme } from '@/constants/theme'
import { telemetry } from '@/modules/board/constants/telemetry'
import {
  getHistoryMetricHotRange,
  type HistoryMetricKey,
} from '@/modules/history/lib/metricColorScale'

const EMPTY_SERIES: ChartSeriesData = { ts: [], vs: [] }

function seededRandom(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0xffffffff
  }
}

function generateSparklineData(
  count: number,
  base: number,
  variance: number,
  seed: number,
): SparklinePoint[] {
  const now = Date.now()
  const random = seededRandom(seed)
  const points: SparklinePoint[] = []
  let value = base
  for (let i = 0; i < count; i++) {
    value += (random() - 0.48) * variance
    value = Math.max(base - variance * 3, Math.min(base + variance * 3, value))
    points.push({ ts: now - (count - i) * 1000, value })
  }
  return points
}

function generateChartSeries({
  count,
  base,
  variance,
  seed,
  spikeEvery = 0,
}: {
  count: number
  base: number
  variance: number
  seed: number
  spikeEvery?: number
}): ChartSeriesData {
  const now = Date.now()
  const random = seededRandom(seed)
  const ts: number[] = []
  const vs: number[] = []
  let value = base
  for (let i = 0; i < count; i += 1) {
    value += (random() - 0.5) * variance
    if (spikeEvery > 0 && i % spikeEvery === 0) value += variance * (1.8 + random())
    ts.push(now - (count - i) * 1000)
    vs.push(Math.max(0, value))
  }
  return { ts, vs }
}

function SparklineShowcase() {
  const [color, setColor] = useState(telemetry.speed.color)
  const points = useMemo(() => generateSparklineData(120, 42, 2, 11), [])

  return (
    <ShowcaseCard
      name="Sparkline"
      controls={
        <>
          <ChipRow
            label="color"
            options={[
              telemetry.speed.color,
              telemetry.duty.color,
              telemetry.controllerTemp.color,
              theme.palette.yellow.color,
            ]}
            selected={color}
            onSelect={setColor}
          />
        </>
      }
    >
      <Sparkline points={points} color={color} height={32} fmtMax={(v) => `${v.toFixed(1)} V`} />
    </ShowcaseCard>
  )
}

function AnimatedSingleGaugeShowcase() {
  const [metricKey, setMetricKey] = useState<'speed' | 'duty' | 'motorTemp' | 'controllerTemp'>(
    'speed',
  )
  const value = useSharedValue<number | null>(34)
  const metric = telemetry[metricKey]
  const hotMetricKey: HistoryMetricKey =
    metricKey === 'motorTemp'
      ? 'tempMotor'
      : metricKey === 'controllerTemp'
        ? 'tempController'
        : metricKey
  const hotRange = getHistoryMetricHotRange(hotMetricKey)

  useEffect(() => {
    value.value = 0
    value.value = withRepeat(
      withTiming(metric.chartRange.max, {
        duration: 1800,
        easing: Easing.inOut(Easing.quad),
      }),
      -1,
      true,
    )
  }, [metric.chartRange.max, value])

  const handleMetricChange = useCallback((next: string) => {
    const key = next as typeof metricKey
    setMetricKey(key)
  }, [])

  return (
    <ShowcaseCard
      name="SingleGauge / animated ramp"
      controls={
        <ChipRow
          label="metric"
          options={['speed', 'duty', 'motorTemp', 'controllerTemp']}
          selected={metricKey}
          onSelect={handleMetricChange}
        />
      }
    >
      <SingleGauge
        value={value}
        min={metric.chartRange.min}
        max={metric.chartRange.max}
        color={metric.color}
        unit={metric.unit}
        decimals={metric.decimals}
        label={metric.label.toUpperCase()}
        hotRange={hotRange}
        alerts={[
          {
            id: 'warn',
            threshold: metric.chartRange.max * 0.75,
            thresholdMax: null,
          },
          {
            id: 'range',
            threshold: metric.chartRange.max * 0.88,
            thresholdMax: metric.chartRange.max * 0.98,
          },
        ]}
      />
    </ShowcaseCard>
  )
}

function AnimatedDualGaugeShowcase() {
  const [compact, setCompact] = useState(false)
  const speed = useSharedValue<number | null>(0)
  const duty = useSharedValue<number | null>(0)

  const speedSeries = useMemo(() => generateSparklineData(60, 28, 6, 11), [])
  const dutySeries = useMemo(() => generateSparklineData(60, 55, 14, 23), [])

  useEffect(() => {
    speed.value = withRepeat(
      withTiming(50, { duration: 2600, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    )
    duty.value = withRepeat(
      withTiming(100, { duration: 1700, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    )
  }, [duty, speed])

  return (
    <ShowcaseCard
      name="DualGauge / animated ramp"
      controls={<ToggleRow label="compact" value={compact} onToggle={setCompact} />}
    >
      <DualGauge
        speedValue={speed}
        dutyValue={duty}
        speedSeries={speedSeries}
        dutySeries={dutySeries}
        compact={compact}
        speedAlerts={[{ id: 'speed-warn', threshold: 42, thresholdMax: null }]}
        dutyAlerts={[{ id: 'duty-warn', threshold: 80, thresholdMax: 95 }]}
      />
    </ShowcaseCard>
  )
}

function LinearGaugeShowcase() {
  const [empty, setEmpty] = useState(false)
  const [charging, setCharging] = useState(false)
  const [percent, setPercent] = useState('82')
  const [mode, setMode] = useState<'live' | 'stale' | 'stale old'>('live')

  const stale = mode !== 'live'
  const voltageText = telemetry.battVoltage.formatWithUnit(74.5)
  const value = Number(percent)

  return (
    <ShowcaseCard
      name="LinearGauge"
      controls={
        <>
          <ToggleRow label="empty" value={empty} onToggle={setEmpty} />
          <ToggleRow label="charging" value={charging} onToggle={setCharging} />
          <ChipRow
            label="percent"
            options={['5', '24', '62', '82', '98']}
            selected={percent}
            onSelect={setPercent}
          />
          <ChipRow
            label="last battery"
            options={['live', 'stale', 'stale old']}
            selected={mode}
            onSelect={(v) => setMode(v as typeof mode)}
          />
        </>
      }
    >
      <LinearGauge
        value={empty ? null : value}
        max={100}
        color={stale ? theme.palette.slate.textSecondary : telemetry.battVoltage.color}
        unit="%"
        aux={empty ? undefined : mode === 'stale old' ? `${voltageText} · 2h ago` : voltageText}
        charging={charging}
        alerts={[
          // One of each rule flavor: one-shot (tick only), geiger and repeating (both band the
          // rest of the scale, since both keep making noise above where their marks stop).
          { id: 'one-shot', threshold: 20, thresholdMax: null },
          { id: 'geiger', threshold: 40, thresholdMax: 60 },
          { id: 'repeating', threshold: 90, thresholdMax: null, repeats: true },
        ]}
        hint={empty ? 'Set battery config in board settings' : undefined}
      />
    </ShowcaseCard>
  )
}

/** The overlay a detail chart wears until its focused series lands. */
function ChartLoadingOverlayShowcase() {
  const [loading, setLoading] = useState(true)
  const data = useMemo(
    () => generateChartSeries({ count: 120, base: 24, variance: 6, seed: 7 }),
    [],
  )
  const charts = useMemo(
    () => [
      {
        key: 'speed',
        label: 'Tap to toggle the overlay',
        height: 70,
        left: {
          range: computeAutoRangeFromValues(data.vs, {
            includeZero: true,
            minSpan: 10,
            paddingRatio: 0.1,
          }),
        },
        series: [
          {
            key: 'speed',
            data: loading ? EMPTY_SERIES : data,
            color: telemetry.speed.color,
            unit: telemetry.speed.unit,
            decimals: telemetry.speed.decimals,
          },
        ],
      },
    ],
    [data, loading],
  )

  return (
    <ShowcaseCard name="ChartLoadingOverlay">
      <Pressable onPress={() => setLoading((on) => !on)}>
        <View>
          <ChartStack charts={charts} containerStyle={styles.chartExample} />
          {loading ? <ChartLoadingOverlay /> : null}
        </View>
      </Pressable>
    </ShowcaseCard>
  )
}

const CELL_SCENARIOS = {
  'Small imbalance': {
    cells: [4.012, 4.03, 4.028, 4.031, 4.019, 4.03, 4.027, 4.03, 4.025, 4.029],
    balancing: [true, false, false, false, true, false, false, false, false, false],
  },
  Balanced: {
    cells: [4.03, 4.03, 4.031, 4.03, 4.03, 4.029, 4.03, 4.03, 4.03, 4.03],
    balancing: [],
  },
  'Dead group': {
    cells: [4.03, 4.031, 3.62, 4.03, 4.029, 4.03, 4.028, 4.03, 4.031, 4.03],
    balancing: [],
  },
} as const

function BmsCellVoltagesShowcase() {
  const [scenario, setScenario] = useState<keyof typeof CELL_SCENARIOS>('Small imbalance')
  const summary = useMemo(() => {
    const { cells, balancing } = CELL_SCENARIOS[scenario]
    return summarizeBms({
      capturedAt: 0,
      voltageTotal: cells.reduce((s, v) => s + v, 0),
      vCharge: 0,
      current: 0,
      currentIc: 0,
      ampHours: 0,
      wattHours: 0,
      soc: null,
      soh: null,
      cellVoltages: [...cells],
      balancing: [...balancing],
      temps: [],
      tempIc: null,
      tempHum: null,
      hum: null,
      tempMaxCell: null,
      canId: null,
    })
  }, [scenario])
  const windowStats = useMemo(() => {
    const { cells } = CELL_SCENARIOS[scenario]
    return summarizeBmsWindow([
      {
        capturedAt: 0,
        cellVoltages: cells.map((v, index) => v - (index === 0 ? 0.006 : 0)),
        balancing: [],
      },
      { capturedAt: 1000, cellVoltages: [...cells], balancing: [] },
      {
        capturedAt: 2000,
        cellVoltages: cells.map((v, index) => v - (index === 2 ? 0.01 : 0)),
        balancing: [],
      },
    ])
  }, [scenario])

  return (
    <ShowcaseCard name="BmsCellVoltages / horizontal cell rows">
      <ChipRow
        label="Scenario"
        options={Object.keys(CELL_SCENARIOS)}
        selected={scenario}
        onSelect={(v) => setScenario(v as keyof typeof CELL_SCENARIOS)}
      />
      {summary ? (
        <BmsCellVoltagesView summary={summary} windowStats={windowStats} windowMs={5 * 60_000} />
      ) : null}
    </ShowcaseCard>
  )
}

export default function ChartsPage() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={ChartLineUpIcon}
          description="ChartStack, Sparkline, LinearGauge, SingleGauge, DualGauge, ChartLoadingOverlay, BmsCellVoltages."
        />
        <ChartStackShowcase />
        <SparklineShowcase />
        <LinearGaugeShowcase />
        <AnimatedSingleGaugeShowcase />
        <AnimatedDualGaugeShowcase />
        <ChartLoadingOverlayShowcase />
        <BmsCellVoltagesShowcase />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.palette.slate.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
  chartExample: { marginBottom: 10 },
})
