import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Svg, { Polyline } from 'react-native-svg'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

export interface SpringTraceSample {
  t: number
  position: number
  target: number
}

interface SpringTraceChartProps {
  label: string
  samples: SpringTraceSample[]
  windowMs: number
  height?: number
  format?: (value: number) => string
}

const DEFAULT_HEIGHT = 72
const INSET = 3
const MIN_SPAN = 1e-6

/**
 * Two-series scope: spring position against its target over a rolling window.
 * `Sparkline` only draws a single series, so tuning needs its own chart.
 */
export function SpringTraceChart({
  label,
  samples,
  windowMs,
  height = DEFAULT_HEIGHT,
  format = (v) => v.toFixed(4),
}: SpringTraceChartProps) {
  const [width, setWidth] = useState(0)
  const last = samples[samples.length - 1]

  let points = ''
  let targets = ''
  if (width > 0 && samples.length > 1 && last) {
    const tMax = last.t
    const tMin = tMax - windowMs
    let lo = Number.POSITIVE_INFINITY
    let hi = Number.NEGATIVE_INFINITY
    for (const s of samples) {
      lo = Math.min(lo, s.position, s.target)
      hi = Math.max(hi, s.position, s.target)
    }
    if (hi - lo < MIN_SPAN) {
      const mid = (hi + lo) / 2
      lo = mid - MIN_SPAN
      hi = mid + MIN_SPAN
    }
    const x = (t: number) => ((t - tMin) / windowMs) * width
    const y = (v: number) => height - INSET - ((v - lo) / (hi - lo)) * (height - INSET * 2)
    for (const s of samples) {
      points += `${x(s.t).toFixed(1)},${y(s.position).toFixed(1)} `
      targets += `${x(s.t).toFixed(1)},${y(s.target).toFixed(1)} `
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.readout}>
          <Text style={styles.position}>{last ? format(last.position) : '-'}</Text>
          <Text style={styles.separator}> / </Text>
          <Text style={styles.target}>{last ? format(last.target) : '-'}</Text>
        </Text>
      </View>
      <View
        style={[styles.plot, { height }]}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        <Svg width={width} height={height}>
          <Polyline
            points={targets.trim()}
            fill="none"
            stroke={theme.palette.slate.textMuted}
            strokeWidth={1}
            strokeDasharray="3,3"
          />
          <Polyline
            points={points.trim()}
            fill="none"
            stroke={theme.palette.sky.color}
            strokeWidth={1.5}
          />
        </Svg>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 4 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: {
    color: theme.palette.slate.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  readout: { fontSize: 10, fontFamily: 'monospace' },
  position: { color: theme.palette.sky.color },
  separator: { color: theme.palette.slate.textDim },
  target: { color: theme.palette.slate.textMuted },
  plot: {
    backgroundColor: theme.palette.slate.surfaceDeep,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.palette.slate.border,
    overflow: 'hidden',
  },
})
