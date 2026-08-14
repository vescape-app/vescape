import { StyleSheet } from 'react-native'
import { Canvas, Text } from '@shopify/react-native-skia'
import { useDerivedValue } from 'react-native-reanimated'

import { formatClock, formatRelative } from '@/components/charts/line/chartFormat'
import {
  AXIS_WIDTH,
  TIME_AXIS_BASELINE,
  TIME_AXIS_HEIGHT,
} from '@/components/charts/line/chartLayout'
import { useChartStack } from '@/components/charts/line/ChartStackContext'
import { GapMarkersLayer } from '@/components/charts/line/GapMarkersLayer'
import { viewportFor } from '@/components/charts/line/projection'
import { toRealMs } from '@/components/charts/line/timeline'
import { theme } from '@/constants/theme'

const AXIS_TEXT_COLOR = theme.palette.slate.textDim
/** Below this window, wall-clock labels gain seconds — above it they would never change. */
const CLOCK_SECONDS_BELOW_MS = 10 * 60_000

export interface ChartTimeAxisProps {
  /** `clock` labels the real time of day; `relative` counts back from the live head. */
  timeMode: 'clock' | 'relative'
  /** Width of one mono glyph, measured once on the JS thread. */
  glyphWidth: number
}

/**
 * The stretch of time on screen, written once under the whole stack.
 *
 * Its own canvas rather than a strip of the last chart's: it belongs to the group, not to whichever
 * metric happens to sit at the bottom, and a chart closing must not take the time axis with it.
 */
export function ChartTimeAxis({ timeMode, glyphWidth }: ChartTimeAxisProps) {
  // See SeriesLayer: derived values and React Compiler memoisation do not mix.
  'use no memo'
  const { camera, dataKey, domainStartMs, domainEndMs, timeline, plotWidth, axisFont, isEmpty } =
    useChartStack()

  const viewport = useDerivedValue(
    () => viewportFor(camera.value, dataKey, domainStartMs, domainEndMs),
    [camera, dataKey, domainEndMs, domainStartMs],
  )
  const startLabel = useDerivedValue(() => {
    const { startMs, endMs } = viewport.value
    if (timeMode === 'relative') return formatRelative(domainEndMs - startMs)
    return formatClock(toRealMs(startMs, timeline), endMs - startMs < CLOCK_SECONDS_BELOW_MS)
  }, [domainEndMs, timeMode, timeline, viewport])
  const endLabel = useDerivedValue(() => {
    const { startMs, endMs } = viewport.value
    if (timeMode === 'relative') return formatRelative(domainEndMs - endMs)
    return formatClock(toRealMs(endMs, timeline), endMs - startMs < CLOCK_SECONDS_BELOW_MS)
  }, [domainEndMs, timeMode, timeline, viewport])
  const endLabelX = useDerivedValue(() => {
    const { startMs, endMs } = viewport.value
    const withSeconds = endMs - startMs < CLOCK_SECONDS_BELOW_MS
    return AXIS_WIDTH + plotWidth - glyphWidth * (withSeconds ? 8 : 5)
  }, [glyphWidth, plotWidth, viewport])

  // The strip still takes its height while a ride loads — an empty frame that keeps the panel
  // still is the point — but there is no window yet to name.
  if (!axisFont || isEmpty) return <Canvas style={styles.canvas} />

  return (
    <Canvas style={styles.canvas}>
      <GapMarkersLayer
        variant="labels"
        timeline={timeline}
        camera={camera}
        dataKey={dataKey}
        domainStartMs={domainStartMs}
        domainEndMs={domainEndMs}
        plotX={AXIS_WIDTH}
        plotWidth={plotWidth}
        labelBaseline={TIME_AXIS_BASELINE}
        font={axisFont}
      />
      <Text
        font={axisFont}
        x={AXIS_WIDTH}
        y={TIME_AXIS_BASELINE}
        text={startLabel}
        color={AXIS_TEXT_COLOR}
      />
      <Text
        font={axisFont}
        x={endLabelX}
        y={TIME_AXIS_BASELINE}
        text={endLabel}
        color={AXIS_TEXT_COLOR}
      />
    </Canvas>
  )
}

const styles = StyleSheet.create({
  canvas: { width: '100%', height: TIME_AXIS_HEIGHT },
})
