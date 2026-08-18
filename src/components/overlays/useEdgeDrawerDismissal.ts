import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Keyboard,
  ScrollView,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type View,
} from 'react-native'
import { Gesture } from 'react-native-gesture-handler'
import {
  Easing as ReanimatedEasing,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import {
  DRAWER_INITIAL_OPEN_FRACTION,
  edgeDrawerDismissOpacity,
  edgeDrawerHasCommitted,
  edgeDrawerRestoreOffset,
  edgeDrawerScrollEndAction,
  edgeDrawerVisibleFraction,
} from '@/components/overlays/edgeDrawerDismiss'
import { measureTrigger } from '@/components/overlays/measureTrigger'

/** Approximate native fling travel from Android's release velocity in points/ms. */
const DRAWER_FLING_PROJECTION_MS = 250
const DRAWER_OPEN_TRANSLATE_Y = 42
const DRAWER_OPEN_DURATION = 200
/** Dismissal is a fast fade back toward the drawer's own edge, not a scroll home. */
const DRAWER_CLOSE_DURATION = 170
const DRAWER_BOTTOM_CONTENT_PADDING = 32

export interface EdgeDrawerDismissalOptions {
  visible: boolean
  edge: 'auto' | 'top' | 'bottom'
  triggerRef: React.RefObject<View | null>
  initialFocusRef?: React.RefObject<View | null>
  autoScrollOnContentExpand: boolean
  contentEndThreshold: number
  onClose: () => void
  onReachContentEnd?: () => void
}

/**
 * The drawer's whole open/close life: which edge it came from, the scroll offset that doubles as a
 * dismissal gesture, and the presence value both the panel and the scrim animate on.
 */
// Reanimated shared values are mutable handles by design. React's immutability
// lint cannot distinguish their UI-thread writes from React-owned state.
/* eslint-disable react-hooks/immutability */
export function useEdgeDrawerDismissal({
  visible,
  edge,
  triggerRef,
  initialFocusRef,
  autoScrollOnContentExpand,
  contentEndThreshold,
  onClose,
  onReachContentEnd,
}: EdgeDrawerDismissalOptions) {
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const [mounted, setMounted] = useState(false)
  const [closeRequested, setCloseRequested] = useState(false)
  const [opensFromTop, setOpensFromTop] = useState(true)
  const [dismissRange, setDismissRange] = useState(0)
  const [keyboardInset, setKeyboardInset] = useState(0)
  const scrollRef = useRef<ScrollView>(null)
  const positionedRef = useRef(false)
  const openStartedRef = useRef(false)
  const dismissRangeRef = useRef(0)
  const previousContentHeightRef = useRef(0)
  const scrollOffsetRef = useRef(0)
  const scrollOffset = useSharedValue(0)
  /** 0 hidden at the drawer's own edge, 1 fully present. Drives both open and close. */
  const presence = useSharedValue(0)
  /** Scroll-driven dismissal only arms once the drawer has taken its opening position. */
  const dismissArmed = useSharedValue(false)
  const dismissTriggered = useSharedValue(false)
  const animatedDismissRange = useSharedValue(1)
  const nativeScrollGesture = useMemo(() => Gesture.Native(), [])

  useEffect(() => {
    if (!visible) return

    const openFrom = (fromTop: boolean) => {
      setOpensFromTop(fromTop)
      setMounted(true)
      setDismissRange(0)
      setCloseRequested(false)
      dismissRangeRef.current = 0
      positionedRef.current = false
      previousContentHeightRef.current = 0
      setKeyboardInset(0)
      scrollOffsetRef.current = 0
      scrollOffset.value = 0
      openStartedRef.current = false
      dismissArmed.value = false
      dismissTriggered.value = false
      presence.value = 0
    }

    if (edge !== 'auto') {
      openFrom(edge === 'top')
      return
    }

    void measureTrigger(triggerRef).then((trigger) => {
      openFrom(trigger.y + trigger.height / 2 < height / 2)
    })
  }, [dismissArmed, dismissTriggered, edge, height, presence, scrollOffset, triggerRef, visible])

  /**
   * The Modal window appears a frame or more after mount, so the opening animation is started by
   * `onShow` — kicked off any earlier it would already be over by the time anything is on screen.
   */
  const startOpen = useCallback(() => {
    if (openStartedRef.current) return
    openStartedRef.current = true
    presence.value = withTiming(1, {
      duration: DRAWER_OPEN_DURATION,
      easing: ReanimatedEasing.out(ReanimatedEasing.quad),
    })
  }, [presence])

  useEffect(() => {
    if (!mounted) return
    const showSubscription = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardInset(event.endCoordinates.height)
    })
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardInset(0)
    })
    return () => {
      showSubscription.remove()
      hideSubscription.remove()
    }
  }, [mounted])

  const finishClose = useCallback(() => {
    setCloseRequested(false)
    setMounted(false)
    setDismissRange(0)
    onClose()
  }, [onClose])

  const closing = closeRequested || (!visible && mounted)

  const close = useCallback(() => {
    setCloseRequested(true)
  }, [])

  useEffect(() => {
    if (!closing || !mounted) return

    presence.value = withTiming(
      0,
      { duration: DRAWER_CLOSE_DURATION, easing: ReanimatedEasing.in(ReanimatedEasing.quad) },
      (finished) => {
        if (finished) runOnJS(finishClose)()
      },
    )
  }, [closing, finishClose, mounted, presence])

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      const offset = event.contentOffset.y
      scrollOffset.value = offset

      if (!dismissArmed.value || dismissTriggered.value) return

      // Commit to closing mid-drag, the moment the drawer passes the point of no return.
      const fraction = edgeDrawerVisibleFraction({
        offset,
        range: animatedDismissRange.value,
        height,
        opensFromTop,
      })
      if (edgeDrawerHasCommitted(fraction)) {
        dismissTriggered.value = true
        runOnJS(close)()
      }
    },
  })

  // The scrim rides the same curve as the panel. Left on the raw fraction it is still half dark at
  // the commit mark, and killing that in one timed step reads as the whole overlay popping out.
  const backdropStyle = useAnimatedStyle(() => {
    'worklet'
    const dismissed = edgeDrawerDismissOpacity(
      edgeDrawerVisibleFraction({
        offset: scrollOffset.value,
        range: animatedDismissRange.value,
        height,
        opensFromTop,
      }),
    )
    return { opacity: presence.value * dismissed }
  })

  const presenceStyle = useAnimatedStyle(() => {
    'worklet'
    const hidden = 1 - presence.value
    const dismissed = edgeDrawerDismissOpacity(
      edgeDrawerVisibleFraction({
        offset: scrollOffset.value,
        range: animatedDismissRange.value,
        height,
        opensFromTop,
      }),
    )
    return {
      opacity: presence.value * dismissed,
      transform: [
        {
          translateY: hidden * (opensFromTop ? -DRAWER_OPEN_TRANSLATE_Y : DRAWER_OPEN_TRANSLATE_Y),
        },
      ],
    }
  })

  const handleContentSizeChange = useCallback(
    (_contentWidth: number, contentHeight: number) => {
      const previousRange = dismissRangeRef.current
      const range = Math.max(1, contentHeight - height)
      const previousContentHeight = previousContentHeightRef.current
      previousContentHeightRef.current = contentHeight
      setDismissRange(range)
      dismissRangeRef.current = range
      animatedDismissRange.value = range
      if (!positionedRef.current) {
        positionedRef.current = true
        const initialOpenOffset = Math.min(range, height * DRAWER_INITIAL_OPEN_FRACTION)
        const initialOffset = opensFromTop ? 0 : initialOpenOffset
        scrollOffsetRef.current = initialOffset
        scrollOffset.value = initialOffset
        requestAnimationFrame(() => {
          scrollRef.current?.scrollTo({ y: initialOffset, animated: false })
          dismissArmed.value = true
          if (!initialFocusRef?.current) return
          requestAnimationFrame(() => {
            const nativeScrollRef = scrollRef.current?.getNativeScrollRef()
            if (!initialFocusRef.current || !nativeScrollRef) return
            initialFocusRef.current.measureLayout(
              nativeScrollRef,
              (_x, focusY, _width, focusHeight) => {
                const visibleCenter = height * (opensFromTop ? 0.375 : 0.625)
                const minimumOffset = opensFromTop ? 0 : initialOffset
                const focusedOffset = Math.max(
                  minimumOffset,
                  Math.min(range, focusY + focusHeight / 2 - visibleCenter),
                )
                scrollOffsetRef.current = focusedOffset
                scrollOffset.value = focusedOffset
                scrollRef.current?.scrollTo({ y: focusedOffset, animated: false })
              },
            )
          })
        })
        return
      }

      const bottomDrawerWasFullyOpen = !opensFromTop && scrollOffsetRef.current >= previousRange - 1
      if (!initialFocusRef && bottomDrawerWasFullyOpen && range > previousRange) {
        requestAnimationFrame(() => {
          scrollRef.current?.scrollTo({ y: range, animated: true })
        })
      } else if (autoScrollOnContentExpand && contentHeight > previousContentHeight) {
        const addedHeight = contentHeight - previousContentHeight
        const targetOffset = opensFromTop
          ? Math.min(range, scrollOffsetRef.current + addedHeight)
          : range
        requestAnimationFrame(() => {
          scrollRef.current?.scrollTo({ y: targetOffset, animated: true })
        })
      }
    },
    [
      animatedDismissRange,
      autoScrollOnContentExpand,
      dismissArmed,
      height,
      initialFocusRef,
      opensFromTop,
      scrollOffset,
    ],
  )

  /** Settle a half-faded drawer back to the offset where it is fully opaque again. */
  const restoreFullyVisible = useCallback(() => {
    scrollRef.current?.scrollTo({
      y: edgeDrawerRestoreOffset(dismissRangeRef.current, height, opensFromTop),
      animated: true,
    })
  }, [height, opensFromTop])

  const scrollToOpenEdge = useCallback(() => {
    scrollRef.current?.scrollTo({
      y: opensFromTop ? 0 : dismissRangeRef.current + height,
      animated: true,
    })
  }, [height, opensFromTop])

  const handleScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offset = event.nativeEvent.contentOffset.y
      scrollOffsetRef.current = offset
      // A dismissal fade is already running; let it finish rather than cutting to an unmount.
      if (closing) return
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
      if (action === 'finish') {
        finishClose()
        return
      }

      const distanceFromEnd =
        event.nativeEvent.contentSize.height - (offset + event.nativeEvent.layoutMeasurement.height)
      if (distanceFromEnd <= contentEndThreshold) onReachContentEnd?.()
      if (action === 'close') close()
      if (action === 'restore') restoreFullyVisible()
    },
    [
      close,
      closing,
      contentEndThreshold,
      dismissRange,
      finishClose,
      height,
      onReachContentEnd,
      opensFromTop,
      restoreFullyVisible,
    ],
  )

  const handleScrollEndDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
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
      if (action === 'close') {
        close()
        return
      }

      handleScrollEnd(event)
    },
    [close, dismissRange, handleScrollEnd, height, opensFromTop],
  )

  return {
    mounted,
    closing,
    opensFromTop,
    scrollRef,
    nativeScrollGesture,
    backdropStyle,
    presenceStyle,
    edgePadding: opensFromTop
      ? insets.top
      : insets.bottom + DRAWER_BOTTOM_CONTENT_PADDING + keyboardInset,
    close,
    startOpen,
    scrollToOpenEdge,
    scrollHandler,
    handleContentSizeChange,
    handleScrollEnd,
    handleScrollEndDrag,
    dismissAreaHeight: height,
  }
}
/* eslint-enable react-hooks/immutability */
