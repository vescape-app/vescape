import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'

import {
  AXIS_FONT_SIZE,
  AXIS_WIDTH,
  CHART_GAP,
  LABEL_FONT_SIZE,
  LABEL_HEIGHT,
  computeRowBands,
  plotWidthFor,
} from '@/components/charts/line/chartLayout'
import {
  ChartStackProvider,
  type ChartStackContextValue,
} from '@/components/charts/line/ChartStackContext'
import { ChartTimeAxis } from '@/components/charts/line/ChartTimeAxis'
import { LineChart } from '@/components/charts/line/LineChart'
import { SCRUB_FONT_SIZE, useScrubReadout } from '@/components/charts/line/ScrubLayer'
import { toScrubTargets } from '@/components/charts/line/scrubTargets'
import { compactBands, compactCharts, prepareStack } from '@/components/charts/line/stackData'
import { useChartCamera } from '@/components/charts/line/useChartCamera'
import { useChartGestures } from '@/components/charts/line/useChartGestures'
import { toChartMs, toRealMs, type ChartTimeline } from '@/components/charts/line/timeline'
import type { ChartBand, ChartSpec, ChartTimeRange } from '@/components/charts/line/types'
import { useRenderRateWarning } from '@/hooks/useRenderRateWarning'
import { useSkiaFont, useSkiaMonoFont } from '@/hooks/useSkiaFont'
import { useThemeStore } from '@/hooks/useTheme'
import { textAdvanceWidth } from '../../../helpers/skiaText'

export type { ChartSpec } from '@/components/charts/line/types'

const FULL_VIEW_EPSILON_MS = 1
export const CHART_CHANGE_FADE_MS = 120

export interface ChartStackProps {
  bands?: ChartBand[]
  charts: ChartSpec[]
  timeline?: ChartTimeline | null
  follow?: boolean
  dataKey?: string
  timeMode?: 'clock' | 'relative'
  scrubTimeMs?: SharedValue<number | null>
  zoomWindowMs?: SharedValue<ChartTimeRange | null>
  initialZoomMs?: ChartTimeRange | null
  selection?: SharedValue<ChartTimeRange | null>
  onSelectionChange?: (range: ChartTimeRange) => void
  onSelectionPreview?: (range: ChartTimeRange) => void
  onChartTouch?: (key: string) => void
  showHead?: boolean
  animateChartChanges?: boolean
  visibleChartKeys?: ReadonlySet<string>
  containerStyle?: StyleProp<ViewStyle>
}

export function ChartStack({
  charts,
  follow = false,
  dataKey = '',
  timeMode = 'clock',
  scrubTimeMs,
  zoomWindowMs,
  initialZoomMs,
  selection,
  onSelectionChange,
  onSelectionPreview,
  onChartTouch,
  bands,
  timeline = null,
  showHead = false,
  animateChartChanges = false,
  visibleChartKeys,
  containerStyle,
}: ChartStackProps) {
  'use no memo'
  useRenderRateWarning('ChartStack')
  const [width, setWidth] = useState(0)
  const labelFont = useSkiaFont('600', LABEL_FONT_SIZE)
  const axisFont = useSkiaMonoFont('500', AXIS_FONT_SIZE)
  const scrubFont = useSkiaMonoFont('600', SCRUB_FONT_SIZE)

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(Math.round(event.nativeEvent.layout.width))
  }, [])

  const ownScrubTimeMs = useSharedValue<number | null>(null)
  const scrub = scrubTimeMs ?? ownScrubTimeMs

  const compacted = useMemo(() => compactCharts(charts, timeline), [charts, timeline])
  const stackBands = useMemo(() => compactBands(bands, timeline), [bands, timeline])
  const prepared = useMemo(() => prepareStack(compacted, dataKey), [compacted, dataKey])
  const previousChartKeysRef = useRef<ReadonlySet<string>>(
    new Set(prepared.charts.map((chart) => chart.key)),
  )
  const addedChartKeys = new Set(
    prepared.charts
      .map((chart) => chart.key)
      .filter((key) => !previousChartKeysRef.current.has(key)),
  )
  useEffect(() => {
    previousChartKeysRef.current = new Set(prepared.charts.map((chart) => chart.key))
  }, [prepared.charts])
  const camera = useChartCamera({
    startMs: prepared.startMs,
    endMs: prepared.endMs,
    dataKey,
  })

  const adoptedZoomKey = useRef<string | null>(null)
  if (adoptedZoomKey.current !== dataKey && !prepared.isEmpty) {
    adoptedZoomKey.current = dataKey
    if (initialZoomMs) {
      const startMs = toChartMs(initialZoomMs.startMs, timeline)
      const endMs = toChartMs(initialZoomMs.endMs, timeline)
      if (endMs > startMs) camera.camera.value = { spanMs: endMs - startMs, endMs, key: dataKey }
    }
  }

  const plotWidth = plotWidthFor(width)

  const glyphWidth = axisFont ? textAdvanceWidth(axisFont, '0') : 0
  const scrubGlyphWidth = scrubFont ? textAdvanceWidth(scrubFont, '0') : 0
  const appearance = useThemeStore((state) => state.resolvedTheme)
  const scrubCharts = useMemo(
    () =>
      prepared.charts.map((chart) => ({
        targets: toScrubTargets(chart, appearance),
        plot: { x: AXIS_WIDTH, y: LABEL_HEIGHT, width: plotWidth, height: chart.height },
      })),
    [appearance, plotWidth, prepared],
  )
  const readout = useScrubReadout({
    charts: scrubCharts,
    camera: camera.camera,
    dataKey: camera.dataKey,
    domainStartMs: prepared.startMs,
    domainEndMs: prepared.endMs,
    scrubTimeMs: scrub,
    timeline,
    glyphWidth: scrubGlyphWidth,
  })

  const plotBands = useMemo(
    () => computeRowBands(compacted.map((chart) => chart.height)),
    [compacted],
  )
  const handleChartTouch = useCallback(
    (index: number) => {
      const key = charts[index]?.key
      if (key != null) onChartTouch?.(key)
    },
    [charts, onChartTouch],
  )

  const gesture = useChartGestures({
    camera: camera.camera,
    dataKey,
    domainStartMs: prepared.startMs,
    domainEndMs: prepared.endMs,
    plotWidth,
    plotX: AXIS_WIDTH,
    follow,
    scrubTimeMs: scrub,
    selection,
    onSelectionCommit: onSelectionChange,
    onSelectionPreview,
    plotBands,
    onChartTouch: handleChartTouch,
    timeline,
    enabled: width > 0 && !prepared.isEmpty,
  })

  useAnimatedReaction(
    () => camera.viewport.value,
    (window) => {
      if (zoomWindowMs == null) return
      const whole =
        window.startMs <= prepared.startMs + FULL_VIEW_EPSILON_MS &&
        window.endMs >= prepared.endMs - FULL_VIEW_EPSILON_MS
      zoomWindowMs.value = whole
        ? null
        : { startMs: toRealMs(window.startMs, timeline), endMs: toRealMs(window.endMs, timeline) }
    },
    [prepared.endMs, prepared.startMs, timeline, zoomWindowMs],
  )

  const context = useMemo<ChartStackContextValue>(
    () => ({
      camera: camera.camera,
      dataKey: camera.dataKey,
      domainStartMs: prepared.startMs,
      domainEndMs: prepared.endMs,
      scrubTimeMs: scrub,
      selection,
      readout,
      timeline,
      stackBands,
      isEmpty: prepared.isEmpty,
      plotWidth,
      labelFont,
      axisFont,
      scrubFont,
      showHead,
    }),
    [
      axisFont,
      camera.camera,
      camera.dataKey,
      labelFont,
      plotWidth,
      prepared.endMs,
      prepared.isEmpty,
      prepared.startMs,
      readout,
      scrub,
      scrubFont,
      selection,
      showHead,
      stackBands,
      timeline,
    ],
  )

  return (
    <View style={containerStyle} onLayout={onLayout}>
      {width > 0 && (
        <ChartStackProvider value={context}>
          <GestureDetector gesture={gesture}>
            <View style={styles.column}>
              {prepared.charts.map((chart, index) => (
                <ChartRow
                  key={chart.key}
                  chartKey={chart.key}
                  visible={!visibleChartKeys || visibleChartKeys.has(chart.key)}
                  fadeIn={animateChartChanges && addedChartKeys.has(chart.key)}
                >
                  <LineChart chart={chart} width={width} index={index} />
                </ChartRow>
              ))}
              <ChartTimeAxis timeMode={timeMode} glyphWidth={glyphWidth} />
            </View>
          </GestureDetector>
        </ChartStackProvider>
      )}
    </View>
  )
}

interface ChartRowProps {
  chartKey: string
  visible: boolean
  fadeIn: boolean
  children: React.ReactNode
}

function ChartRow({ chartKey, visible, fadeIn, children }: ChartRowProps) {
  const opacity = useSharedValue(fadeIn ? 0 : visible ? 1 : 0)
  useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, { duration: CHART_CHANGE_FADE_MS })
  }, [opacity, visible])
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }))

  return (
    <Animated.View testID={`chart-row-${chartKey}`} style={style}>
      {children}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  column: { width: '100%', gap: CHART_GAP },
})
