import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { ChartStack, type ChartSpec } from '@/components/charts/line/ChartStack'
import type { ChartSeriesData } from '@/components/charts/line/types'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow } from '@/components/dev/ShowcaseControls'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

const BASE = new Date('2026-01-01T09:00:00').getTime()

const SIZES = {
  tiny: { count: 40, stepMs: 500 },
  '9k': { count: 9_000, stepMs: 33 },
  '36k': { count: 36_000, stepMs: 500 },
  '170k': { count: 170_000, stepMs: 500 },
} as const

type SizeKey = keyof typeof SIZES

/** Deterministic ride-shaped signal with occasional one-sample spikes to prove they survive. */
function generateSeries(count: number, stepMs: number, seed: number, scale: number) {
  const ts: number[] = []
  const vs: number[] = []
  let state = seed
  for (let i = 0; i < count; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0
    const noise = (state / 0xffffffff - 0.5) * 4
    const wave = Math.sin(i / (count / 40)) * 0.35 + 0.5
    const spike = i % 1_997 === 0 ? scale * 0.45 : 0
    ts.push(BASE + i * stepMs)
    vs.push(Math.max(0, wave * scale + noise + spike))
  }
  return { ts, vs }
}

function rangeOf(data: ChartSeriesData) {
  let min = data.vs[0]
  let max = data.vs[0]
  for (const value of data.vs) {
    if (value < min) min = value
    if (value > max) max = value
  }
  return { min: Math.floor(min), max: Math.ceil(max) }
}

export function ChartStackShowcase() {
  const [size, setSize] = useState<SizeKey>('tiny')
  const { count, stepMs } = SIZES[size]

  const speed = useMemo(() => generateSeries(count, stepMs, 7, 42), [count, stepMs])
  const duty = useMemo(() => generateSeries(count, stepMs, 21, 85), [count, stepMs])
  const volts = useMemo(() => generateSeries(count, stepMs, 55, 60), [count, stepMs])

  const charts = useMemo<ChartSpec[]>(
    () => [
      {
        key: 'speed',
        label: 'Speed',
        height: 48,
        series: [{ key: 'speed', data: speed, color: theme.palette.cyan.color, unit: 'km/h' }],
        left: { range: rangeOf(speed) },
      },
      {
        key: 'duty',
        label: 'Duty / Voltage',
        height: 40,
        series: [
          { key: 'duty', data: duty, color: theme.palette.amber.color, label: 'Duty', unit: '%' },
          {
            key: 'volts',
            data: volts,
            color: theme.palette.violet.color,
            axis: 'right',
            label: 'Pack',
            unit: 'V',
          },
        ],
        left: { range: rangeOf(duty) },
        right: { range: rangeOf(volts) },
      },
    ],
    [duty, speed, volts],
  )

  return (
    <ShowcaseCard name="ChartStack / one canvas, shared camera">
      <ChipRow
        label="Dataset"
        options={Object.keys(SIZES)}
        selected={size}
        onSelect={(value) => setSize(value as SizeKey)}
      />
      <Text style={styles.note}>
        {count.toLocaleString()} samples per series, drawn from a min/max pyramid — the spikes are
        single samples. Drag to scrub, pinch to zoom and pan, double-tap to fit.
      </Text>
      <View style={styles.stack}>
        <ChartStack charts={charts} dataKey={size} timeMode="clock" />
      </View>
    </ShowcaseCard>
  )
}

const styles = StyleSheet.create({
  stack: {
    marginTop: 8,
  },
  note: {
    color: theme.palette.slate.textSecondary,
    fontSize: 11,
    marginTop: 6,
  },
})
