import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FlatList, ScrollView } from 'react-native'
import {
  Keyboard,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ReactNativeElement,
  type View,
} from 'react-native'
import { Gesture } from 'react-native-gesture-handler'
import {
  Easing as ReanimatedEasing,
  type SharedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import {
  DRAWER_INITIAL_OPEN_FRACTION,
  edgeDrawerContentResizeOffset,
  edgeDrawerFocusOffset,
  edgeDrawerOpaqueFloorOffset,
  edgeDrawerDragStartsAtEdge,
  edgeDrawerRestoreOffset,
} from '@/components/overlays/edgeDrawerDismiss'
import { useDrawerScrollEnd } from '@/components/overlays/edgeDrawerScrollEnd'
import { useDrawerScrollAnimation } from '@/components/overlays/edgeDrawerScrollAnimation'
import { measureTrigger } from '@/components/overlays/measureTrigger'

const DRAWER_OPEN_DURATION = 200
/** Dismissal is a fast fade back toward the drawer's own edge, not a scroll home. */
const DRAWER_CLOSE_DURATION = 170
const DRAWER_BOTTOM_CONTENT_PADDING = 32

export interface EdgeDrawerDismissalOptions {
  visible: boolean
  edge: 'auto' | 'top' | 'bottom'
  triggerRef: React.RefObject<View | null>
  initialFocusRef?: React.RefObject<View | null>
  initialFocusLayout?: { offset: number; height: number }
  virtualized?: boolean
  autoScrollOnContentExpand: boolean
  contentPageKey?: string
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
  initialFocusLayout,
  virtualized = false,
  autoScrollOnContentExpand,
  contentPageKey,
  onClose,
  onReachContentEnd,
}: EdgeDrawerDismissalOptions) {
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const [mounted, setMounted] = useState(false)
  const [closeRequested, setCloseRequested] = useState(false)
  const [opensFromTop, setOpensFromTop] = useState(true)
  const [dismissRange, setDismissRange] = useState(0)
  const [keyboardInset, setKeyboardInset] = useDrawerKeyboardInset(mounted)
  const scrollRef = useRef<ScrollView | FlatList<unknown>>(null)
  const positionedRef = useRef(false)
  // Layout callbacks can race UI-thread shared-value writes. Keep the requested JS position
  // authoritative until native acknowledges it through onScroll.
  const openingScrollPendingRef = useRef(false)
  const indexedFocusAppliedRef = useRef(false)
  const openStartedRef = useRef(false)
  const dismissRangeRef = useRef(0)
  const previousContentHeightRef = useRef(0)
  const scrollOffsetRef = useRef(0)
  const previousContentPageKeyRef = useRef(contentPageKey)
  const pinContentStartRef = useRef(false)
  const scrollOffset = useSharedValue(0)
  /** 0 hidden at the drawer's own edge, 1 fully present. Drives both open and close. */
  const presence = useSharedValue(0)
  /** Scroll-driven dismissal only arms once the drawer has taken its opening position. */
  const dismissArmed = useSharedValue(false)
  // Native can deliver its initial zero-offset event after JS requests the opening scroll.
  // Keep that event from overwriting the position used by content-resize handling.
  const openingScrollTarget = useSharedValue(-1)
  const dismissTriggered = useSharedValue(false)
  const animatedDismissRange = useSharedValue(1)
  const nativeScrollGesture = useMemo(() => Gesture.Native(), [])
  const {
    dragFromEdge,
    dragging,
    flingGuard,
    chromeDrag,
    restoreTargetRef,
    userScrollRef,
    resetGestures,
    handleScrollBeginDrag,
  } = useDismissGestures(openingScrollTarget, dismissRangeRef, height, opensFromTop)
  const scrollToOffset = useDrawerScrollToOffset(scrollRef, userScrollRef)

  const scrollToContentStart = useCallback(
    (range: number) => {
      // A bottom drawer keeps the height it had, unless it was scrolled into the old page or would
      // fade on the new one. The sticky header pins below the status bar; a page starting flush at
      // the screen top would tuck its first row under it.
      const contentStart = Math.min(scrollOffsetRef.current, height - insets.top)
      const offset = opensFromTop
        ? 0
        : Math.min(range, Math.max(contentStart, edgeDrawerRestoreOffset(range, height, false)))
      scrollOffsetRef.current = offset
      scrollOffset.value = offset
      requestAnimationFrame(() => scrollToOffset(offset, false))
    },
    [height, insets.top, opensFromTop, scrollOffset, scrollToOffset],
  )

  useEffect(() => {
    if (previousContentPageKeyRef.current === contentPageKey) return
    previousContentPageKeyRef.current = contentPageKey
    if (!mounted || contentPageKey === undefined) return
    pinContentStartRef.current = true
    scrollToContentStart(dismissRangeRef.current)
  }, [contentPageKey, mounted, scrollToContentStart])

  useEffect(() => {
    if (!visible) return

    const openFrom = (fromTop: boolean) => {
      setOpensFromTop(fromTop)
      setMounted(true)
      setDismissRange(0)
      setCloseRequested(false)
      dismissRangeRef.current = 0
      positionedRef.current = false
      openingScrollPendingRef.current = false
      indexedFocusAppliedRef.current = false
      previousContentHeightRef.current = 0
      setKeyboardInset(0)
      scrollOffsetRef.current = 0
      pinContentStartRef.current = false
      scrollOffset.value = 0
      openStartedRef.current = false
      dismissArmed.value = false
      openingScrollTarget.value = -1
      dismissTriggered.value = false
      resetGestures()
      presence.value = 0
    }

    if (edge !== 'auto') {
      openFrom(edge === 'top')
      return
    }

    void measureTrigger(triggerRef).then((trigger) => {
      openFrom(trigger.y + trigger.height / 2 < height / 2)
    })
  }, [
    dismissArmed,
    dismissTriggered,
    edge,
    height,
    presence,
    openingScrollTarget,
    resetGestures,
    scrollOffset,
    setKeyboardInset,
    triggerRef,
    visible,
  ])

  /**
   * The Modal window appears a frame or more after mount, so the opening animation is started by
   * `onShow` — kicked off any earlier it would already be over by the time anything is on screen.
   */
  const animateOpen = useDrawerOpenAnimation(openStartedRef, presence)
  const startOpen = useCallback(() => {
    animateOpen()
    // Content layout can run before the Modal's native scroll view is attached. Reapply its
    // latest opening position once onShow confirms that the window is visible.
    requestAnimationFrame(() => {
      if (positionedRef.current) scrollToOffset(scrollOffsetRef.current, false)
    })
  }, [animateOpen, scrollToOffset])

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
  const finishOpeningScroll = useCallback(() => {
    openingScrollPendingRef.current = false
  }, [])

  useEffect(() => {
    if (!closing || !mounted) return

    presence.value = withTiming(
      0,
      { duration: DRAWER_CLOSE_DURATION, easing: ReanimatedEasing.in(ReanimatedEasing.quad) },
      (finished) => {
        if (finished) scheduleOnRN(finishClose)
      },
    )
  }, [closing, finishClose, mounted, presence])

  /** Settle a half-faded drawer back to the offset where it is fully opaque again. */
  const restoreFullyVisible = useCallback(() => {
    const target = edgeDrawerRestoreOffset(dismissRangeRef.current, height, opensFromTop)
    // iOS reports a scroll end when a new animated scroll interrupts the running one. Reissuing
    // the restore from that report interrupts it again, forever, and pins the list in place.
    // The target is fractional and iOS lands on a pixel; asking again from there loops the same way.
    if (restoreTargetRef.current === target || Math.abs(scrollOffsetRef.current - target) <= 1)
      return
    restoreTargetRef.current = target
    scrollToOffset(target, true)
  }, [height, opensFromTop, restoreTargetRef, scrollToOffset])

  const { scrollHandler, backdropStyle, presenceStyle } = useDrawerScrollAnimation({
    openingScrollTarget,
    scrollOffset,
    dismissArmed,
    dismissTriggered,
    dragFromEdge,
    dragging,
    flingGuard,
    chromeDrag,
    restoreFullyVisible,
    animatedDismissRange,
    height,
    opensFromTop,
    presence,
    close,
    finishOpeningScroll,
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
        const focus = initialFocusLayout
        const initialOffset = focus
          ? edgeDrawerFocusOffset({
              offset: focus.offset,
              itemHeight: focus.height,
              range,
              height,
              opensFromTop,
            })
          : opensFromTop
            ? 0
            : initialOpenOffset
        openingScrollTarget.value = initialOffset > 0 ? initialOffset : -1
        openingScrollPendingRef.current = initialOffset > 0
        scrollOffsetRef.current = initialOffset
        scrollOffset.value = initialOffset
        requestAnimationFrame(() => {
          // A header layout may already have focused the row. Never overwrite it with
          // the default opening offset from an earlier content-size callback.
          if (!indexedFocusAppliedRef.current) {
            if (focus) indexedFocusAppliedRef.current = true
            // Content may have grown since this callback was queued. Use its latest target.
            scrollToOffset(scrollOffsetRef.current, false)
          }
          if (!openingScrollPendingRef.current) dismissArmed.value = true
          if (!initialFocusRef?.current) return
          requestAnimationFrame(() => {
            const nativeScrollRef = scrollRef.current?.getNativeScrollRef() as
              | ReactNativeElement
              | undefined
            if (!initialFocusRef.current || !nativeScrollRef) return
            initialFocusRef.current.measureLayout(
              nativeScrollRef,
              (_x, focusY, _width, focusHeight) => {
                const focusedOffset = edgeDrawerFocusOffset({
                  offset: focusY,
                  itemHeight: focusHeight,
                  range,
                  height,
                  opensFromTop,
                })
                scrollOffsetRef.current = focusedOffset
                scrollOffset.value = focusedOffset
                if (openingScrollPendingRef.current) openingScrollTarget.value = focusedOffset
                scrollToOffset(focusedOffset, false)
              },
            )
          })
        })
        return
      }

      if (pinContentStartRef.current) {
        scrollToContentStart(range)
        return
      }

      // Content grows over many frames, so this follows every one of them from the live offset —
      // a per-frame "was the drawer fully open?" test loses the race after the first frame and
      // leaves the drawer stranded half faded.
      const pinsToOwnEdge =
        !virtualized &&
        !opensFromTop &&
        range !== previousRange &&
        !initialFocusRef &&
        !initialFocusLayout
      const liveOffset = openingScrollPendingRef.current
        ? scrollOffsetRef.current
        : scrollOffset.value
      const resize = { offset: liveOffset, range, previousRange, height }
      const pinnedOffset = resizedOffset(resize, pinsToOwnEdge, opensFromTop)
      if (pinsToOwnEdge || pinnedOffset !== liveOffset) {
        scrollOffsetRef.current = pinnedOffset
        scrollOffset.value = pinnedOffset
        if (openingScrollPendingRef.current) openingScrollTarget.value = pinnedOffset
        // The content layout event can precede the native scroll view's new bounds. Scrolling
        // immediately can clamp to the previous size and strand late rows below the pinned header.
        // Like opening and page changes, wait for layout and use the latest requested position.
        requestAnimationFrame(() => scrollToOffset(scrollOffsetRef.current, false))
        return
      }

      if (autoScrollOnContentExpand && contentHeight > previousContentHeight) {
        const addedHeight = contentHeight - previousContentHeight
        const targetOffset = opensFromTop
          ? Math.min(range, scrollOffsetRef.current + addedHeight)
          : range
        requestAnimationFrame(() => {
          scrollToOffset(targetOffset, true)
        })
      }
    },
    [
      animatedDismissRange,
      autoScrollOnContentExpand,
      dismissArmed,
      height,
      initialFocusRef,
      initialFocusLayout,
      virtualized,
      opensFromTop,
      openingScrollTarget,
      scrollOffset,
      scrollToOffset,
      scrollToContentStart,
    ],
  )

  // Unlike ref measurement, a known frame can focus a row that FlatList has never mounted.
  const focusOffset = initialFocusLayout?.offset
  const focusHeight = initialFocusLayout?.height
  useEffect(() => {
    if (
      !visible ||
      !mounted ||
      !positionedRef.current ||
      indexedFocusAppliedRef.current ||
      focusOffset == null ||
      focusHeight == null
    )
      return
    const frame = requestAnimationFrame(() => {
      // A late header/layout pass can temporarily report only the first render window.
      // Wait until native content bounds can contain the target instead of locking in a clamp.
      if (dismissRangeRef.current < focusOffset + focusHeight / 2 - height / 2) return
      const target = edgeDrawerFocusOffset({
        offset: focusOffset,
        itemHeight: focusHeight,
        range: dismissRangeRef.current,
        height,
        opensFromTop,
      })
      indexedFocusAppliedRef.current = true
      scrollOffsetRef.current = target
      if (openingScrollPendingRef.current) openingScrollTarget.value = target
      scrollOffset.value = target
      scrollToOffset(target, false)
    })
    return () => cancelAnimationFrame(frame)
  }, [
    visible,
    mounted,
    dismissRange,
    focusOffset,
    focusHeight,
    height,
    opensFromTop,
    openingScrollTarget,
    scrollOffset,
    scrollToOffset,
  ])

  const scrollToOpenEdge = useCallback(() => {
    scrollToOffset(opensFromTop ? 0 : dismissRangeRef.current + height, true)
  }, [height, opensFromTop, scrollToOffset])

  const { handleScrollEnd, handleScrollEndDrag } = useDrawerScrollEnd({
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
  })

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
    handleScrollBeginDrag,
    chromeDrag,
    dismissTriggered,
    scrollOffset,
    animatedDismissRange,
    dismissAreaHeight: height,
  }
}

/** A bottom drawer's offset after its content resized; see the two policies it picks between. */
function resizedOffset(
  resize: { offset: number; range: number; previousRange: number; height: number },
  pinsToOwnEdge: boolean,
  opensFromTop: boolean,
) {
  if (pinsToOwnEdge) return edgeDrawerContentResizeOffset(resize)
  if (!opensFromTop && resize.range > resize.previousRange) {
    return edgeDrawerOpaqueFloorOffset(resize)
  }
  return resize.offset
}

/**
 * Gesture state that decides how a drawer may be dismissed: scroll dismissal arms only for drags
 * that start at the content edge, and chrome drags move the panel directly.
 */
function useDismissGestures(
  openingScrollTarget: SharedValue<number>,
  dismissRangeRef: React.RefObject<number>,
  height: number,
  opensFromTop: boolean,
) {
  /** The current drag began at the content edge, so it may carry the drawer off screen. */
  const dragFromEdge = useSharedValue(true)
  /** A finger is on the scroll view. Only a drag commits a dismissal mid-scroll. */
  const dragging = useSharedValue(false)
  /** A fling from inside the content is running; stop it where it meets the content edge. */
  const flingGuard = useSharedValue(false)
  /** Translation from dragging the drawer's chrome toward its edge. */
  const chromeDrag = useSharedValue(0)
  /** The rider's drag, or its momentum, owns the scroll; any programmatic scroll takes it back. */
  const userScrollRef = useRef(false)
  /** Offset an animated restore is heading to, until it lands or the rider takes over. */
  const restoreTargetRef = useRef<number | null>(null)
  const resetGestures = useCallback(() => {
    restoreTargetRef.current = null
    userScrollRef.current = false
    dragging.value = false
    dragFromEdge.value = true
    flingGuard.value = false
    chromeDrag.value = 0
  }, [chromeDrag, dragFromEdge, dragging, flingGuard])
  const handleScrollBeginDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      // The rider has taken over: an opening scroll still awaiting its native echo is moot.
      openingScrollTarget.value = -1
      restoreTargetRef.current = null
      userScrollRef.current = true
      dragging.value = true
      flingGuard.value = false
      dragFromEdge.value = edgeDrawerDragStartsAtEdge({
        offset: event.nativeEvent.contentOffset.y,
        range: dismissRangeRef.current,
        height,
        opensFromTop,
      })
    },
    [
      dismissRangeRef,
      dragFromEdge,
      dragging,
      flingGuard,
      height,
      openingScrollTarget,
      opensFromTop,
    ],
  )
  return {
    dragFromEdge,
    dragging,
    flingGuard,
    chromeDrag,
    restoreTargetRef,
    userScrollRef,
    resetGestures,
    handleScrollBeginDrag,
  }
}

function useDrawerKeyboardInset(mounted: boolean) {
  const [keyboardInset, setKeyboardInset] = useState(0)
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
  return [keyboardInset, setKeyboardInset] as const
}

function useDrawerOpenAnimation(
  openStartedRef: React.RefObject<boolean>,
  presence: SharedValue<number>,
) {
  const startOpen = useCallback(() => {
    if (openStartedRef.current) return
    openStartedRef.current = true
    presence.value = withTiming(1, {
      duration: DRAWER_OPEN_DURATION,
      easing: ReanimatedEasing.out(ReanimatedEasing.quad),
    })
  }, [openStartedRef, presence])
  return startOpen
}

function useDrawerScrollToOffset(
  scrollRef: React.RefObject<ScrollView | FlatList | null>,
  userScrollRef: React.RefObject<boolean>,
) {
  const scrollToOffset = useCallback(
    (y: number, animated: boolean) => {
      const scroll = scrollRef.current
      if (!scroll) return
      userScrollRef.current = false
      if ('scrollToOffset' in scroll) scroll.scrollToOffset({ offset: y, animated })
      else scroll.scrollTo({ y, animated })
    },
    [scrollRef, userScrollRef],
  )
  return scrollToOffset
}
/* eslint-enable react-hooks/immutability */
