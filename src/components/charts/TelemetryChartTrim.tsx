import { useCallback, useEffect, useMemo, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { Gesture } from 'react-native-gesture-handler'
import {
  cancelAnimation,
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import { Canvas, LinearGradient, Rect, RoundedRect, vec } from '@shopify/react-native-skia'

import {
  moveTrimHandle,
  pickTrimHandle,
  type TrimHandle,
} from '@/components/charts/telemetryChartTrimMath'
import { theme } from '@/constants/theme'

export interface ChartTrimConfig {
  startMs: number
  endMs: number
  onChange: (startMs: number, endMs: number) => void
  onCommit: (startMs: number, endMs: number) => void
}

const TRIM_NOTIFY_THROTTLE_MS = 50
const TRIM_HINT_ANIMATION_MS = 320
const HANDLE_WIDTH = 3

function setSharedValue<T>(shared: SharedValue<T>, value: T) {
  shared.value = value
}

function createTrimGesture({
  enabled,
  chartWidth,
  domainStartMs,
  domainEndMs,
  trimStartMs,
  trimEndMs,
  activeHandle,
  dragOriginMs,
  beginDrag,
  notifyTrim,
  commitTrim,
}: {
  enabled: boolean
  chartWidth: number
  domainStartMs: number
  domainEndMs: number
  trimStartMs: SharedValue<number>
  trimEndMs: SharedValue<number>
  activeHandle: SharedValue<TrimHandle | null>
  dragOriginMs: SharedValue<number>
  beginDrag: () => void
  notifyTrim: (startMs: number, endMs: number) => void
  commitTrim: (startMs: number, endMs: number) => void
}) {
  const span = domainEndMs - domainStartMs
  return Gesture.Pan()
    .enabled(enabled)
    .onBegin((event) => {
      'worklet'
      const xStart = (chartWidth * (trimStartMs.value - domainStartMs)) / span
      const xEnd = (chartWidth * (trimEndMs.value - domainStartMs)) / span
      const handle = pickTrimHandle(event.x, xStart, xEnd)
      activeHandle.value = handle
      dragOriginMs.value = handle === 0 ? trimStartMs.value : trimEndMs.value
      runOnJS(beginDrag)()
    })
    .onUpdate((event) => {
      'worklet'
      if (activeHandle.value === 0) {
        trimStartMs.value = moveTrimHandle({
          handle: 0,
          originMs: dragOriginMs.value,
          translationX: event.translationX,
          chartWidth,
          domainStartMs,
          domainEndMs,
          oppositeMs: trimEndMs.value,
        })
      } else if (activeHandle.value === 1) {
        trimEndMs.value = moveTrimHandle({
          handle: 1,
          originMs: dragOriginMs.value,
          translationX: event.translationX,
          chartWidth,
          domainStartMs,
          domainEndMs,
          oppositeMs: trimStartMs.value,
        })
      }
      runOnJS(notifyTrim)(trimStartMs.value, trimEndMs.value)
    })
    .onFinalize(() => {
      'worklet'
      activeHandle.value = null
      runOnJS(commitTrim)(trimStartMs.value, trimEndMs.value)
    })
}

interface UseChartTrimOptions {
  trim: ChartTrimConfig | undefined
  chartWidth: number
  domainStartMs: number
  domainEndMs: number
}

export function useChartTrim({
  trim,
  chartWidth,
  domainStartMs,
  domainEndMs,
}: UseChartTrimOptions) {
  const onChangeRef = useRef(trim?.onChange)
  const onCommitRef = useRef(trim?.onCommit)
  const lastNotifyAtRef = useRef(0)
  const startMs = useSharedValue(trim?.startMs ?? 0)
  const endMs = useSharedValue(trim?.endMs ?? 0)
  const activeHandle = useSharedValue<TrimHandle | null>(null)
  const dragOriginMs = useSharedValue(0)
  const trimWasActiveRef = useRef(false)
  const draggingRef = useRef(false)
  const trimStartMs = trim?.startMs
  const trimEndMs = trim?.endMs

  useEffect(() => {
    onChangeRef.current = trim?.onChange
    onCommitRef.current = trim?.onCommit
  })

  useEffect(() => {
    if (trimStartMs == null || trimEndMs == null) {
      trimWasActiveRef.current = false
      cancelAnimation(startMs)
      cancelAnimation(endMs)
      return
    }
    if (!trimWasActiveRef.current && domainEndMs > domainStartMs) {
      trimWasActiveRef.current = true
      setSharedValue(startMs, domainStartMs)
      setSharedValue(endMs, domainEndMs)
      startMs.value = withTiming(trimStartMs, { duration: TRIM_HINT_ANIMATION_MS })
      endMs.value = withTiming(trimEndMs, { duration: TRIM_HINT_ANIMATION_MS })
      return
    }
    // Throttled preview updates arrive behind the UI-thread gesture. Never let one rewind a handle.
    if (draggingRef.current) return
    setSharedValue(startMs, trimStartMs)
    setSharedValue(endMs, trimEndMs)
  }, [domainEndMs, domainStartMs, endMs, startMs, trimEndMs, trimStartMs])

  const beginDrag = useCallback(() => {
    draggingRef.current = true
  }, [])
  const notifyTrim = useCallback((start: number, end: number) => {
    const now = Date.now()
    if (now - lastNotifyAtRef.current < TRIM_NOTIFY_THROTTLE_MS) return
    lastNotifyAtRef.current = now
    onChangeRef.current?.(start, end)
  }, [])
  const commitTrim = useCallback((start: number, end: number) => {
    draggingRef.current = false
    lastNotifyAtRef.current = 0
    onCommitRef.current?.(start, end)
  }, [])
  const enabled = !!trim && chartWidth > 0 && domainEndMs > domainStartMs
  const gesture = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs -- shared values are only touched inside worklets
      createTrimGesture({
        enabled,
        chartWidth,
        domainStartMs,
        domainEndMs,
        trimStartMs: startMs,
        trimEndMs: endMs,
        activeHandle,
        dragOriginMs,
        beginDrag,
        notifyTrim,
        commitTrim,
      }),
    [
      activeHandle,
      beginDrag,
      chartWidth,
      commitTrim,
      domainEndMs,
      domainStartMs,
      dragOriginMs,
      enabled,
      endMs,
      notifyTrim,
      startMs,
    ],
  )
  const positionFor = useCallback(
    (value: number) => {
      'worklet'
      const span = domainEndMs - domainStartMs
      const x = span > 0 ? (chartWidth * (value - domainStartMs)) / span : 0
      return Math.max(0, Math.min(chartWidth, x))
    },
    [chartWidth, domainEndMs, domainStartMs],
  )
  const startX = useDerivedValue(() => positionFor(startMs.value))
  const endX = useDerivedValue(() => positionFor(endMs.value))
  const midpointX = useDerivedValue(() => startX.value + (endX.value - startX.value) / 2)
  const leftSelectionWidth = useDerivedValue(() => midpointX.value - startX.value)
  const rightSelectionWidth = useDerivedValue(() => endX.value - midpointX.value)
  const rightDimWidth = useDerivedValue(() => chartWidth - endX.value)
  const startHandleX = useDerivedValue(() => startX.value - HANDLE_WIDTH / 2)
  const endHandleX = useDerivedValue(() => endX.value - HANDLE_WIDTH / 2)
  const leftGradientStart = useDerivedValue(() => vec(startX.value, 0))
  const leftGradientEnd = useDerivedValue(() => vec(midpointX.value, 0))
  const rightGradientStart = useDerivedValue(() => vec(midpointX.value, 0))
  const rightGradientEnd = useDerivedValue(() => vec(endX.value, 0))

  return {
    gesture,
    startX,
    endX,
    midpointX,
    leftSelectionWidth,
    rightSelectionWidth,
    rightDimWidth,
    startHandleX,
    endHandleX,
    leftGradientStart,
    leftGradientEnd,
    rightGradientStart,
    rightGradientEnd,
  }
}

interface TelemetryChartTrimOverlayProps {
  height: number
  chartWidth: number
  trimState: ReturnType<typeof useChartTrim>
}

export function TelemetryChartTrimOverlay({
  height,
  chartWidth,
  trimState,
}: TelemetryChartTrimOverlayProps) {
  return (
    <View style={[styles.overlay, { height }]} pointerEvents="none">
      <Canvas style={[styles.canvas, { width: chartWidth, height }]}>
        <Rect
          x={0}
          y={0}
          width={trimState.startX}
          height={height}
          color={theme.alpha(theme.palette.slate.bg, 0.6)}
        />
        <Rect
          x={trimState.endX}
          y={0}
          width={trimState.rightDimWidth}
          height={height}
          color={theme.alpha(theme.palette.slate.bg, 0.6)}
        />
        <Rect x={trimState.startX} y={0} width={trimState.leftSelectionWidth} height={height}>
          <LinearGradient
            start={trimState.leftGradientStart}
            end={trimState.leftGradientEnd}
            colors={[
              theme.alpha(theme.palette.amber.color, 0.3),
              theme.alpha(theme.palette.amber.color, 0.12),
              theme.alpha(theme.palette.amber.color, 0),
            ]}
            positions={[0, 0.3, 1]}
          />
        </Rect>
        <Rect x={trimState.midpointX} y={0} width={trimState.rightSelectionWidth} height={height}>
          <LinearGradient
            start={trimState.rightGradientStart}
            end={trimState.rightGradientEnd}
            colors={[
              theme.alpha(theme.palette.amber.color, 0),
              theme.alpha(theme.palette.amber.color, 0.12),
              theme.alpha(theme.palette.amber.color, 0.3),
            ]}
            positions={[0, 0.7, 1]}
          />
        </Rect>
        <RoundedRect
          x={trimState.startHandleX}
          y={0}
          width={HANDLE_WIDTH}
          height={height}
          r={HANDLE_WIDTH / 2}
          color={theme.palette.amber.color}
        />
        <RoundedRect
          x={trimState.endHandleX}
          y={0}
          width={HANDLE_WIDTH}
          height={height}
          r={HANDLE_WIDTH / 2}
          color={theme.palette.amber.color}
        />
      </Canvas>
    </View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  canvas: {
    position: 'absolute',
    inset: 0,
  },
})
