import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { withSpring, withTiming, type SharedValue } from 'react-native-reanimated'

import { theme } from '@/constants/theme'

interface MapRevealGestureProps {
  progress: SharedValue<number>
  dragOpacity: SharedValue<number>
  onPanStart: () => void
  onPan: (totalX: number, totalY: number, revealProgress: number) => void
  onZoomStart: () => void
  onZoom: (scale: number) => void
  onZoomEnd: () => void
  onReveal: () => void
  onRevealCancel: () => void
  onFinish: (revealed: boolean) => void
  enabled: boolean
  paused?: boolean
}

interface MapRevealGestureViewProps extends MapRevealGestureProps {
  children: ReactNode
}

const REVEAL_DISTANCE_DP = 120
const PINCH_GRACE_MS = 120
const FADE_TIMING = { duration: 260 } as const
const REVEAL_SPRING = {
  damping: 18,
  stiffness: 160,
  mass: 0.8,
} as const

function createMapRevealGesture({
  progress,
  dragOpacity,
  onPanStart,
  onPan,
  onZoomStart,
  onZoom,
  onZoomEnd,
  onReveal,
  onRevealCancel,
  onFinish,
  enabled,
  paused = false,
}: MapRevealGestureProps) {
  let completed = false
  let pinching = false
  let multiTouch = false
  let pendingSettle: { revealed: boolean } | null = null
  let settleTimer: ReturnType<typeof setTimeout> | null = null

  const settle = (revealed: boolean) => {
    if (!revealed) {
      progress.value = withSpring(0, REVEAL_SPRING)
      dragOpacity.value = withTiming(0, FADE_TIMING)
    }
    onFinish(revealed)
  }

  const deferSettle = (revealed: boolean) => {
    pendingSettle = { revealed }
    if (settleTimer) clearTimeout(settleTimer)
    settleTimer = setTimeout(() => {
      settleTimer = null
      const deferred = pendingSettle
      pendingSettle = null
      if (deferred) settle(deferred.revealed)
    }, PINCH_GRACE_MS)
  }

  const flushSettle = (revealed: boolean) => {
    if (settleTimer) {
      clearTimeout(settleTimer)
      settleTimer = null
    }
    pendingSettle = null
    settle(revealed)
  }

  const pan = Gesture.Pan()
    .enabled(enabled && !paused)
    .runOnJS(true)
    .maxPointers(1)
    .minDistance(4)
    .onTouchesDown((event) => {
      multiTouch = event.numberOfTouches > 1
      completed = false
      progress.value = 0
      dragOpacity.value = 0
    })
    .onBegin(() => {
      completed = false
      progress.value = 0
      dragOpacity.value = 0
      onPanStart()
    })
    .onStart(() => {
      completed = false
      progress.value = 0
      dragOpacity.value = 0
    })
    .onUpdate((event) => {
      const distance = Math.hypot(event.translationX, event.translationY)
      const shouldReveal = distance >= REVEAL_DISTANCE_DP && !multiTouch && !pinching
      const nextProgress = Math.min(1, distance / REVEAL_DISTANCE_DP)
      dragOpacity.value = nextProgress
      if (completed) {
        onPan(event.translationX, event.translationY, 1)
        return
      }

      if (shouldReveal) {
        completed = true
        progress.value = 1
        dragOpacity.value = 1
        onPan(event.translationX, event.translationY, 1)
        onReveal()
        return
      }

      progress.value = nextProgress * nextProgress
      onPan(event.translationX, event.translationY, nextProgress)
    })
    .onFinalize(() => {
      const wasCompleted = completed
      completed = false
      if (pinching || multiTouch) {
        deferSettle(wasCompleted)
        return
      }
      settle(wasCompleted)
    })

  const pinch = Gesture.Pinch()
    .enabled(enabled && !paused)
    .runOnJS(true)
    .onBegin(() => {
      pinching = true
      if (completed || pendingSettle?.revealed) onRevealCancel()
      if (settleTimer) {
        clearTimeout(settleTimer)
        settleTimer = null
      }
      if (pendingSettle) pendingSettle = { revealed: false }
      completed = false
      multiTouch = true
      progress.value = 0
      dragOpacity.value = 0
      onZoomStart()
    })
    .onUpdate((event) => {
      onZoom(event.scale)
    })
    .onFinalize(() => {
      pinching = false
      onZoomEnd()
      if (pendingSettle) flushSettle(false)
    })

  return Gesture.Simultaneous(pan, pinch)
}

function useLatestCallback<Args extends unknown[]>(callback: (...args: Args) => void) {
  const callbackRef = useRef(callback)
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])
  return useCallback((...args: Args) => callbackRef.current(...args), [])
}

export function MapRevealGesture({
  progress,
  dragOpacity,
  onPanStart,
  onPan,
  onZoomStart,
  onZoom,
  onZoomEnd,
  onReveal,
  onRevealCancel,
  onFinish,
  enabled,
  paused,
  children,
}: MapRevealGestureViewProps) {
  'use no memo'
  useEffect(() => {
    progress.value = 0
    dragOpacity.value = 0
  }, [dragOpacity, progress])

  const handlePanStart = useLatestCallback(onPanStart)
  const handlePan = useLatestCallback(onPan)
  const handleZoomStart = useLatestCallback(onZoomStart)
  const handleZoom = useLatestCallback(onZoom)
  const handleZoomEnd = useLatestCallback(onZoomEnd)
  const handleReveal = useLatestCallback(onReveal)
  const handleRevealCancel = useLatestCallback(onRevealCancel)
  const handleFinish = useLatestCallback(onFinish)

  const gesture = useMemo(
    () =>
      createMapRevealGesture({
        progress,
        dragOpacity,
        onPanStart: handlePanStart,
        onPan: handlePan,
        onZoomStart: handleZoomStart,
        onZoom: handleZoom,
        onZoomEnd: handleZoomEnd,
        onReveal: handleReveal,
        onRevealCancel: handleRevealCancel,
        onFinish: handleFinish,
        enabled,
        paused,
      }),
    [
      enabled,
      paused,
      dragOpacity,
      handleFinish,
      handlePan,
      handlePanStart,
      handleReveal,
      handleRevealCancel,
      handleZoom,
      handleZoomEnd,
      handleZoomStart,
      progress,
    ],
  )

  return (
    <GestureDetector gesture={gesture}>
      <View pointerEvents={enabled ? 'auto' : 'none'} style={styles.hitArea}>
        {children}
      </View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  hitArea: {
    ...StyleSheet.absoluteFill,
    zIndex: 6,
    backgroundColor: theme.alpha(theme.palette.mono.black, 0),
  },
})
