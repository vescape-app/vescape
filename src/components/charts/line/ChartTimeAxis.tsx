import { StyleSheet } from 'react-native'
import { Canvas, Text } from '@shopify/react-native-skia'
import { useDerivedValue } from 'react-native-reanimated'

import { formatClock } from '@/helpers/time'
import { useTimeFormat } from '@/hooks/useTimeFormat'
import { formatRelative } from '@/components/charts/line/chartFormat'
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
import { useResolvedNeutralColors } from '@/hooks/useTheme'

const CLOCK_SECONDS_BELOW_MS = 10 * 60_000

export interface ChartTimeAxisProps {
  timeMode: 'clock' | 'relative'
  glyphWidth: number
}

export function ChartTimeAxis({ timeMode, glyphWidth }: ChartTimeAxisProps) {
  'use no memo'
  const timeFormat = useTimeFormat()
  const neutral = useResolvedNeutralColors()
  const {
    camera,
    dataKey,
    domainStartMs,
    domainEndMs,
    timeline,
    plotWidth,
    axisFont,
    isEmpty,
    readout,
  } = useChartStack()

  const viewport = useDerivedValue(
    () => viewportFor(camera.value, dataKey, domainStartMs, domainEndMs),
    [camera, dataKey, domainEndMs, domainStartMs],
  )
  const startLabel = useDerivedValue(() => {
    const { startMs, endMs } = viewport.value
    if (timeMode === 'relative') return formatRelative(domainEndMs - startMs)
    return formatClock(
      toRealMs(startMs, timeline),
      endMs - startMs < CLOCK_SECONDS_BELOW_MS,
      timeFormat,
    )
  }, [domainEndMs, timeMode, timeFormat, timeline, viewport])
  const endLabel = useDerivedValue(() => {
    const { startMs, endMs } = viewport.value
    if (timeMode === 'relative') return formatRelative(domainEndMs - endMs)
    return formatClock(
      toRealMs(endMs, timeline),
      endMs - startMs < CLOCK_SECONDS_BELOW_MS,
      timeFormat,
    )
  }, [domainEndMs, timeMode, timeFormat, timeline, viewport])
  const endLabelX = useDerivedValue(() => {
    return AXIS_WIDTH + Math.max(0, plotWidth - glyphWidth * endLabel.value.length)
  }, [endLabel, glyphWidth, plotWidth])
  const scrubTimeX = useDerivedValue(() => {
    const width = readout.value.time.length * glyphWidth
    const centered = readout.value.cursorX - width / 2
    return AXIS_WIDTH + Math.min(Math.max(centered, 0), Math.max(plotWidth - width, 0))
  }, [glyphWidth, plotWidth])
  const scrubTimeOpacity = useDerivedValue(() => (readout.value.time ? 1 : 0), [])
  const scrubTimeText = useDerivedValue(() => readout.value.time, [])

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
        color={neutral.textDim}
      />
      <Text
        font={axisFont}
        x={endLabelX}
        y={TIME_AXIS_BASELINE}
        text={endLabel}
        color={neutral.textDim}
      />
      <Text
        font={axisFont}
        x={scrubTimeX}
        y={TIME_AXIS_BASELINE}
        text={scrubTimeText}
        color={theme.palette.mono.white}
        opacity={scrubTimeOpacity}
      />
    </Canvas>
  )
}

const styles = StyleSheet.create({
  canvas: { width: '100%', height: TIME_AXIS_HEIGHT },
})
