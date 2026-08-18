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
  /** A pinch started after the drag had already committed — undo the reveal. */
  onRevealCancel: () => void
  onFinish: (revealed: boolean) => void
}

const REVEAL_DISTANCE_DP = 120
/** How long a finished single-finger drag waits for a pinch to claim the touch sequence. */
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
}: MapRevealGestureProps) {
  let completed = false
  let pinching = false
  // Sticky for the whole touch sequence: once a second finger has been down, this was a pinch.
  let multiTouch = false
  // The pan is single-pointer, so it finalizes the instant a second finger lands — before the
  // pinch it belongs to has begun. Settling there would tear down the gesture (and with it the
  // chance to undo a reveal), so the settle waits for the pinch, or for the grace window.
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
      // A second finger on the screen means a pinch, never a reveal — the drag may still pan the
      // map preview, but it must not commit the mode switch.
      const shouldReveal = distance >= REVEAL_DISTANCE_DP && !multiTouch && !pinching
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
      completed = false
      // A pinch is running, or a second finger just landed and one is about to begin: hold the
      // settle so the reveal can still be undone.
      if (pinching || multiTouch) {
        deferSettle(wasCompleted)
        return
      }
      settle(wasCompleted)
    })

  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onBegin(() => {
      pinching = true
      // The fingers of a pinch rarely land together: the first one can travel past the reveal
      // distance before the second arrives, committing a mode switch the rider never asked for.
      // Undo it as soon as the pinch proves the intent was a zoom.
      if (completed || pendingSettle?.revealed) onRevealCancel()
      if (settleTimer) {
        clearTimeout(settleTimer)
        settleTimer = null
      }
      // Whatever the pan left pending is now a plain cancel, settled when the pinch ends.
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
      }),
    [
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
