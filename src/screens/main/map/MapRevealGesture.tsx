import { useCallback, useEffect, useMemo, useRef } from 'react'
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
  onFinish: (revealed: boolean) => void
}

const REVEAL_DISTANCE_DP = 120
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
  onFinish,
}: MapRevealGestureProps) {
  let completed = false
  let pinching = false

  const pan = Gesture.Pan()
    .runOnJS(true)
    .maxPointers(1)
    .minDistance(4)
    .onTouchesDown(() => {
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
      const shouldReveal = distance >= REVEAL_DISTANCE_DP
      const nextProgress = Math.min(1, distance / REVEAL_DISTANCE_DP)
      dragOpacity.value = nextProgress
      // The map always tracks the finger one to one. A drag that never reaches
      // the reveal distance is undone by the spring back to live follow.
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
      if (pinching) {
        completed = false
        return
      }
      if (!completed) {
        progress.value = withSpring(0, REVEAL_SPRING)
        dragOpacity.value = withTiming(0, FADE_TIMING)
      }
      completed = false
      onFinish(wasCompleted)
    })

  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onBegin(() => {
      pinching = true
      completed = false
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
  onFinish,
}: MapRevealGestureProps) {
  'use no memo'
  // The detector only exists while a drag is possible and none is running yet, so any value left
  // here by an earlier tree (a Fast Refresh mid-reveal) is stale and would fade the face out.
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
        onFinish: handleFinish,
      }),
    [
      dragOpacity,
      handleFinish,
      handlePan,
      handlePanStart,
      handleReveal,
      handleZoom,
      handleZoomEnd,
      handleZoomStart,
      progress,
    ],
  )

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.hitArea} />
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  hitArea: {
    ...StyleSheet.absoluteFill,
    zIndex: 5,
    backgroundColor: theme.alpha(theme.palette.mono.black, 0),
  },
})
