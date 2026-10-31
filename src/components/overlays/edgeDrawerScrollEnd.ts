import { useCallback } from 'react'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import type { SharedValue } from 'react-native-reanimated'

import {
  edgeDrawerScrollEndAction,
  edgeDrawerVisibleFraction,
} from '@/components/overlays/edgeDrawerDismiss'

/** Approximate native fling travel from Android's release velocity in points/ms. */
const DRAWER_FLING_PROJECTION_MS = 250
/** How near the end of the drawer content a settled scroll counts as reaching it. */
const CONTENT_END_THRESHOLD = 80

/**
 * Where a released drag or a settled scroll leaves the drawer: closed, restored to fully visible,
 * or open where it stopped. Only the rider's own scroll may fade or close it.
 */
// Reanimated shared values are mutable handles by design.
/* eslint-disable react-hooks/immutability */
export function useDrawerScrollEnd({
  closing,
  dismissRange,
  height,
  opensFromTop,
  scrollOffsetRef,
  pinContentStartRef,
  restoreTargetRef,
  userScrollRef,
  dragFromEdge,
  dragging,
  flingGuard,
  close,
  finishClose,
  restoreFullyVisible,
  onReachContentEnd,
}: {
  closing: boolean
  dismissRange: number
  height: number
  opensFromTop: boolean
  scrollOffsetRef: React.RefObject<number>
  pinContentStartRef: React.RefObject<boolean>
  restoreTargetRef: React.RefObject<number | null>
  userScrollRef: React.RefObject<boolean>
  dragFromEdge: SharedValue<boolean>
  dragging: SharedValue<boolean>
  flingGuard: SharedValue<boolean>
  close: () => void
  finishClose: () => void
  restoreFullyVisible: () => void
  onReachContentEnd?: () => void
}) {
  const handleScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offset = event.nativeEvent.contentOffset.y
      scrollOffsetRef.current = offset
      // A dismissal fade is already running; let it finish rather than cutting to an unmount.
      if (closing) return
      if (restoreTargetRef.current !== null) {
        // Only the restore animation's own landing counts; earlier reports are its interruptions.
        if (Math.abs(offset - restoreTargetRef.current) > 1) return
        restoreTargetRef.current = null
        return
      }
      // Only the rider's scroll may fade or close the drawer. A scroll end that follows a resize
      // or tab swap still carries the old offset against the new range.
      if (!userScrollRef.current) return
      const fullyHidden = opensFromTop ? offset >= dismissRange - 1 : offset <= 1
      const action = edgeDrawerScrollEndAction({
        fullyHidden,
        visibleFraction: edgeDrawerVisibleFraction({
          offset,
          range: dismissRange,
          height,
          opensFromTop,
        }),
      })
      // Momentum from a drag inside the content stops at its edge instead of closing.
      if (!dragFromEdge.value && action !== 'stay-open') {
        restoreFullyVisible()
        return
      }
      if (action === 'finish') {
        finishClose()
        return
      }

      const distanceFromEnd =
        event.nativeEvent.contentSize.height - (offset + event.nativeEvent.layoutMeasurement.height)
      if (distanceFromEnd <= CONTENT_END_THRESHOLD) onReachContentEnd?.()
      if (action === 'close') close()
      if (action === 'restore') restoreFullyVisible()
    },
    [
      close,
      closing,
      dismissRange,
      dragFromEdge,
      finishClose,
      height,
      onReachContentEnd,
      opensFromTop,
      restoreFullyVisible,
      restoreTargetRef,
      userScrollRef,
    ],
  )

  const handleScrollEndDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      pinContentStartRef.current = false
      dragging.value = false
      const { contentOffset, targetContentOffset, velocity } = event.nativeEvent
      scrollOffsetRef.current = contentOffset.y
      const projectedOffset =
        targetContentOffset?.y ?? contentOffset.y - (velocity?.y ?? 0) * DRAWER_FLING_PROJECTION_MS
      const fullyHidden = opensFromTop ? contentOffset.y >= dismissRange - 1 : contentOffset.y <= 1
      const action = edgeDrawerScrollEndAction({
        fullyHidden,
        visibleFraction: edgeDrawerVisibleFraction({
          offset: projectedOffset,
          range: dismissRange,
          height,
          opensFromTop,
        }),
      })

      // Judge the fling by where it is headed instead of waiting for momentum to land.
      if (action === 'close' && dragFromEdge.value) {
        close()
        return
      }
      if (!dragFromEdge.value) flingGuard.value = true

      handleScrollEnd(event)
    },
    [
      close,
      dismissRange,
      dragFromEdge,
      dragging,
      flingGuard,
      handleScrollEnd,
      height,
      opensFromTop,
    ],
  )

  return { handleScrollEnd, handleScrollEndDrag }
}
/* eslint-enable react-hooks/immutability */
