import { useMemo } from 'react'
import { Gesture } from 'react-native-gesture-handler'
import { useSharedValue, type SharedValue } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { MIN_SPAN_MS, projectX, unprojectX, viewportFor } from '@/components/charts/line/projection'
import {
  moveSelectionEdge,
  pickSelectionEdge,
  type SelectionEdge,
} from '@/components/charts/line/selectionMath'
import { toChartMs, toRealMs, type ChartTimeline } from '@/components/charts/line/timeline'
import type {
  ChartCamera,
  ChartPlotBand,
  ChartTimeRange,
  ChartViewport,
} from '@/components/charts/line/types'

const FOLLOW_SNAP_PX = 12

export interface ChartGestureOptions {
  camera: SharedValue<ChartCamera>
  dataKey: string
  domainStartMs: number
  domainEndMs: number
  plotWidth: number
  plotX: number
  follow: boolean
  scrubTimeMs: SharedValue<number | null>
  selection?: SharedValue<ChartTimeRange | null>
  onSelectionCommit?: (range: ChartTimeRange) => void
  onSelectionPreview?: (range: ChartTimeRange) => void
  plotBands: ChartPlotBand[]
  onChartTouch?: (index: number) => void
  timeline: ChartTimeline | null
  enabled: boolean
}

const SELECTION_NOTIFY_MS = 50

const DOUBLE_TAP_MS = 280
const TAP_SLOP_PX = 12

export function useChartGestures({
  camera,
  dataKey,
  domainStartMs,
  domainEndMs,
  plotWidth,
  plotX,
  follow,
  scrubTimeMs,
  selection,
  onSelectionCommit,
  onSelectionPreview,
  plotBands,
  onChartTouch,
  timeline,
  enabled,
}: ChartGestureOptions) {
  const startViewport = useSharedValue<ChartViewport>({ startMs: 0, endMs: 0 })
  const startFocalRatio = useSharedValue(0)
  const lastScrubX = useSharedValue(Number.NaN)
  const draggedEdge = useSharedValue<SelectionEdge | null>(null)
  const dragOriginMs = useSharedValue(0)
  const lastDragX = useSharedValue(Number.NaN)
  const lastNotifyAt = useSharedValue(0)
  const lastTapAt = useSharedValue(0)
  const lastTapX = useSharedValue(0)
  const lastTapY = useSharedValue(0)
  const tapMoved = useSharedValue(false)
  const pinchActive = useSharedValue(false)
  const lastTwoFingerX = useSharedValue(0)

  return useMemo(() => {
    const focalRatio = (focalX: number) => {
      'worklet'
      if (plotWidth <= 0) return 0
      return Math.min(Math.max((focalX - plotX) / plotWidth, 0), 1)
    }

    const scrubTo = (x: number) => {
      'worklet'
      const clamped = Math.round(Math.min(Math.max(x - plotX, 0), plotWidth) * 2) / 2
      if (clamped === lastScrubX.value) return
      lastScrubX.value = clamped
      const viewport = viewportFor(camera.value, dataKey, domainStartMs, domainEndMs)
      scrubTimeMs.value = toRealMs(unprojectX(clamped, viewport, plotWidth), timeline)
    }

    const edgeAt = (x: number) => {
      'worklet'
      const range = selection?.value
      if (range == null || plotWidth <= 0) return null
      const viewport = viewportFor(camera.value, dataKey, domainStartMs, domainEndMs)
      return pickSelectionEdge(
        x - plotX,
        projectX(toChartMs(range.startMs, timeline), viewport, plotWidth),
        projectX(toChartMs(range.endMs, timeline), viewport, plotWidth),
      )
    }

    const chartAtY = (y: number) => {
      'worklet'
      let best = -1
      let bestDistance = Number.POSITIVE_INFINITY
      for (let i = 0; i < plotBands.length; i += 1) {
        const { top, bottom } = plotBands[i]
        const distance = y < top ? top - y : y > bottom ? y - bottom : 0
        if (distance >= bestDistance) continue
        bestDistance = distance
        best = i
      }
      return best
    }

    const pinch = Gesture.Pinch()
      .enabled(enabled)
      .onStart((event) => {
        'worklet'
        startViewport.value = viewportFor(camera.value, dataKey, domainStartMs, domainEndMs)
        startFocalRatio.value = focalRatio(event.focalX)
        pinchActive.value = true
        lastTapAt.value = 0
      })
      .onFinalize(() => {
        'worklet'
        pinchActive.value = false
      })
      .onUpdate((event) => {
        'worklet'
        if (event.numberOfPointers < 2) return
        const { startMs, endMs } = startViewport.value
        const span = endMs - startMs
        if (span <= 0 || plotWidth <= 0) return

        const anchorMs = startMs + startFocalRatio.value * span
        const nextSpan = Math.max(MIN_SPAN_MS, span / Math.max(event.scale, 0.0001))
        const nextStart = anchorMs - focalRatio(event.focalX) * nextSpan
        const nextEnd = nextStart + nextSpan

        const snapMs = (nextSpan / plotWidth) * FOLLOW_SNAP_PX
        const atHead = nextEnd >= domainEndMs - snapMs
        camera.value = {
          spanMs: nextSpan,
          endMs: follow && atHead ? null : nextEnd,
          key: dataKey,
        }
      })

    const drag = Gesture.Pan()
      .enabled(enabled)
      .minPointers(2)
      .averageTouches(true)
      .onStart((event) => {
        'worklet'
        lastTwoFingerX.value = event.translationX
      })
      .onUpdate((event) => {
        'worklet'
        if (event.numberOfPointers < 2) return
        const dx = event.translationX - lastTwoFingerX.value
        lastTwoFingerX.value = event.translationX
        if (pinchActive.value || dx === 0 || plotWidth <= 0) return
        const { startMs, endMs } = viewportFor(camera.value, dataKey, domainStartMs, domainEndMs)
        const span = endMs - startMs
        if (span <= 0) return
        const nextEnd = endMs - (dx / plotWidth) * span
        const snapMs = (span / plotWidth) * FOLLOW_SNAP_PX
        camera.value = {
          spanMs: span,
          endMs: follow && nextEnd >= domainEndMs - snapMs ? null : nextEnd,
          key: dataKey,
        }
      })

    const fitToDomain = () => {
      'worklet'
      camera.value = {
        spanMs: domainEndMs - domainStartMs,
        endMs: follow ? null : domainEndMs,
        key: dataKey,
      }
    }

    const scrub = Gesture.Pan()
      .enabled(enabled)
      .maxPointers(1)
      .minDistance(0)
      .onBegin((event) => {
        'worklet'
        const now = Date.now()
        const isSecondTap =
          now - lastTapAt.value < DOUBLE_TAP_MS &&
          Math.abs(event.x - lastTapX.value) < TAP_SLOP_PX &&
          Math.abs(event.y - lastTapY.value) < TAP_SLOP_PX
        lastTapAt.value = isSecondTap ? 0 : now
        lastTapX.value = event.x
        lastTapY.value = event.y
        tapMoved.value = false
        if (isSecondTap) fitToDomain()
        if (onChartTouch) {
          const index = chartAtY(event.y)
          if (index >= 0) scheduleOnRN(onChartTouch, index)
        }
      })
      .onStart((event) => {
        'worklet'
        lastScrubX.value = Number.NaN
        lastNotifyAt.value = 0
        const edge = edgeAt(event.x)
        draggedEdge.value = edge
        if (edge == null) {
          scrubTo(event.x)
          return
        }
        lastDragX.value = Number.NaN
        const range = selection?.value
        dragOriginMs.value =
          range == null ? 0 : toChartMs(edge === 'start' ? range.startMs : range.endMs, timeline)
      })
      .onUpdate((event) => {
        'worklet'
        if (
          Math.abs(event.translationX) > TAP_SLOP_PX ||
          Math.abs(event.translationY) > TAP_SLOP_PX
        )
          tapMoved.value = true
        const edge = draggedEdge.value
        if (edge == null) {
          scrubTo(event.x)
          return
        }
        const range = selection == null ? null : selection.value
        if (selection == null || range == null) return
        const translationX = Math.round(event.translationX * 2) / 2
        if (translationX === lastDragX.value) return
        lastDragX.value = translationX
        const viewport = viewportFor(camera.value, dataKey, domainStartMs, domainEndMs)
        const movedChart = moveSelectionEdge({
          edge,
          range: {
            startMs: toChartMs(range.startMs, timeline),
            endMs: toChartMs(range.endMs, timeline),
          },
          originMs: dragOriginMs.value,
          translationX,
          plotWidth,
          viewportSpanMs: viewport.endMs - viewport.startMs,
          domainStartMs,
          domainEndMs,
        })
        const moved = {
          startMs: toRealMs(movedChart.startMs, timeline),
          endMs: toRealMs(movedChart.endMs, timeline),
        }
        selection.value = moved
        if (onSelectionPreview == null) return
        const now = Date.now()
        if (now - lastNotifyAt.value < SELECTION_NOTIFY_MS) return
        lastNotifyAt.value = now
        scheduleOnRN(onSelectionPreview, moved)
      })
      .onFinalize(() => {
        'worklet'
        const range = draggedEdge.value != null ? selection?.value : null
        draggedEdge.value = null
        if (tapMoved.value) lastTapAt.value = 0
        scrubTimeMs.value = null
        if (range != null && onSelectionCommit) scheduleOnRN(onSelectionCommit, range)
      })

    return Gesture.Simultaneous(pinch, drag, scrub)
  }, [
    camera,
    dataKey,
    domainEndMs,
    domainStartMs,
    dragOriginMs,
    draggedEdge,
    enabled,
    follow,
    lastDragX,
    lastNotifyAt,
    lastScrubX,
    lastTapAt,
    lastTapX,
    lastTapY,
    lastTwoFingerX,
    onChartTouch,
    onSelectionCommit,
    onSelectionPreview,
    pinchActive,
    plotBands,
    plotWidth,
    plotX,
    scrubTimeMs,
    selection,
    startFocalRatio,
    tapMoved,
    timeline,
    startViewport,
  ])
}
