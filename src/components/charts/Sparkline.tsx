import { useCallback, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import type { LayoutChangeEvent } from 'react-native'
import { Text } from '@/components/base/Text'
import { Canvas } from '@shopify/react-native-skia'

import {
  buildSparklinePaths,
  SparklineLayer,
  type SparklinePoint,
  type SparklineRange,
} from '@/components/charts/SparklineLayer'
import { theme } from '@/constants/theme'

export type { SparklinePoint }

interface SparklineProps {
  points: SparklinePoint[]
  color: string
  height?: number
  showMaxBadge?: boolean
  fmtMax?: (value: number) => string
  range?: SparklineRange
  minSpan?: number
  windowMs?: number
}

interface SparklineMaxBadgeProps {
  points: SparklinePoint[]
  color: string
  fmt: (value: number) => string
  position?: 'left' | 'right'
}

const DEFAULT_HEIGHT = 28
const BADGE_ROW_HEIGHT = 12

export function SparklineMaxBadge({
  points,
  color,
  fmt,
  position = 'right',
}: SparklineMaxBadgeProps) {
  const maxValue = useMemo(() => {
    let max = -Infinity
    for (const point of points) max = Math.max(max, point.value)
    return Number.isFinite(max) ? max : null
  }, [points])
  const value = maxValue == null ? '-' : fmt(maxValue).replace(/(\d)\s+([a-zA-Z%°])/g, '$1$2')
  return (
    <View
      style={[styles.badgeRow, { justifyContent: position === 'left' ? 'flex-start' : 'flex-end' }]}
    >
      <Text style={styles.maxBadge} numberOfLines={1}>
        <Text style={styles.maxLabel}>max </Text>
        <Text style={{ color: maxValue == null ? theme.palette.slate.textDim : color }}>
          {value}
        </Text>
      </Text>
    </View>
  )
}

/** Standalone convenience chart. Use SparklineLayer inside a shared Canvas for grids. */
export function Sparkline({
  points,
  color,
  height = DEFAULT_HEIGHT,
  fmtMax,
  showMaxBadge = true,
  range,
  minSpan = 0,
  windowMs,
}: SparklineProps) {
  const [width, setWidth] = useState(0)
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(Math.round(event.nativeEvent.layout.width))
  }, [])
  const paths = useMemo(
    () => buildSparklinePaths({ points, width, height, range, minSpan, windowMs }),
    [height, minSpan, points, range, width, windowMs],
  )

  return (
    <View style={styles.wrap}>
      {fmtMax && showMaxBadge ? (
        <SparklineMaxBadge points={points} color={color} fmt={fmtMax} position="right" />
      ) : null}
      <View style={{ height }} onLayout={onLayout}>
        {width > 0 ? (
          <Canvas style={{ width, height }}>
            <SparklineLayer paths={paths} color={color} showMax={!!fmtMax} />
          </Canvas>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  badgeRow: { height: BADGE_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center' },
  maxBadge: { fontSize: 9, fontVariant: ['tabular-nums'] },
  maxLabel: { color: theme.palette.slate.textMuted, fontWeight: '500' },
})
