import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  Dimensions,
  Easing,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewStyle,
} from 'react-native'
import { Text } from '@/components/base/Text'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Reanimated, {
  Easing as ReanimatedEasing,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Icon } from 'phosphor-react-native'

import {
  getModalCoordinateOffset,
  measureTrigger,
  type TriggerLayout,
} from '@/components/overlays/measureTrigger'
import {
  DRAWER_INITIAL_OPEN_FRACTION,
  edgeDrawerDismissOpacity,
  edgeDrawerHasCommitted,
  edgeDrawerRestoreOffset,
  edgeDrawerScrollEndAction,
  edgeDrawerVisibleFraction,
} from '@/components/overlays/edgeDrawerDismiss'
import { NativeScrollGestureContext } from '@/components/gestures/NativeScrollGestureContext'
import { theme } from '@/constants/theme'

const OPEN_DURATION = 260
const CLOSE_DURATION = 180
const SCREEN_EDGE_PADDING = 10
/** Fraction of the screen height a sheet is allowed to occupy. */
const HEIGHT_FRACTION = 0.75
/** Approximate native fling travel from Android's release velocity in points/ms. */
const DRAWER_FLING_PROJECTION_MS = 250
const DRAWER_OPEN_TRANSLATE_Y = 42
const DRAWER_OPEN_DURATION = 200
/** Dismissal is a fast fade back toward the drawer's own edge, not a scroll home. */
const DRAWER_CLOSE_DURATION = 170
const DRAWER_BOTTOM_CONTENT_PADDING = 32

const EdgeDrawerScrollContext = createContext<(() => void) | null>(null)

export function useEdgeDrawerScrollToOpenEdge() {
  return useContext(EdgeDrawerScrollContext)
}
type SheetLayoutMode = {
  mode: 'floating'
  matchTriggerWidth: boolean
  minWidth?: number
}

interface ComputedLayout {
  top?: number
  bottom?: number
  left: number
  width: number
  maxHeight: number
  transformOrigin: string
  /** translateY the panel animates in from (px). */
  translateFrom: number
}

function computeLayout(
  layoutMode: SheetLayoutMode,
  trigger: TriggerLayout,
  insets: { top: number; bottom: number },
): ComputedLayout {
  const screen = Dimensions.get('window')
  const screenHeight = screen.height + getModalCoordinateOffset()

  // Floating: centered on the trigger, fully covering it — grows down (or, if
  // short on space, up) from the trigger's own edge instead of dropping below it.
  const topSafe = insets.top + SCREEN_EDGE_PADDING
  const bottomSafe = insets.bottom + SCREEN_EDGE_PADDING
  const spaceAbove = trigger.y + trigger.height - topSafe
  const spaceBelow = screenHeight - trigger.y - bottomSafe
  const preferredMaxHeight = screenHeight * HEIGHT_FRACTION
  const dropAbove = spaceBelow < preferredMaxHeight && spaceAbove > spaceBelow
  const maxHeight = Math.max(120, Math.min(preferredMaxHeight, dropAbove ? spaceAbove : spaceBelow))

  const edgeBoundWidth = screen.width - SCREEN_EDGE_PADDING * 2
  const width = layoutMode.matchTriggerWidth
    ? trigger.width
    : Math.min(
        edgeBoundWidth,
        Math.max(trigger.width, layoutMode.minWidth ?? Math.min(360, edgeBoundWidth)),
      )
  const centeredLeft = trigger.x + trigger.width / 2 - width / 2
  const left = Math.max(
    SCREEN_EDGE_PADDING,
    Math.min(centeredLeft, screen.width - SCREEN_EDGE_PADDING - width),
  )

  if (dropAbove) {
    return {
      bottom: Math.max(insets.bottom, screenHeight - (trigger.y + trigger.height)),
      left,
      width,
      maxHeight,
      transformOrigin: '50% 100%',
      translateFrom: 14,
    }
  }
  return {
    top: Math.max(insets.top, trigger.y),
    left,
    width,
    maxHeight,
    transformOrigin: '50% 0%',
    translateFrom: -14,
  }
}

interface SheetProps {
  visible: boolean
  triggerRef: React.RefObject<View | null>
  onClose: () => void
  layout: SheetLayoutMode
  title?: string
  /** Optional glyph shown left of a centred title. */
  icon?: Icon
  iconColor?: string
  contentContainerStyle?: StyleProp<ViewStyle>
  children: React.ReactNode
}

/**
 * Shared chrome for popover-style "sheets": a translucent, dimmed-backdrop
 * panel that scales + slides in from the trigger that opened it. Positioning
 * (grow from a screen corner vs. float centered under the trigger) is picked
 * via `layout`; {@link FloatingSheet} below wires up
 * the two shapes callers actually need.
 */
function Sheet({
  visible,
  triggerRef,
  onClose,
  layout,
  title,
  icon: IconComponent,
  iconColor = theme.neutral.textSecondary,
  contentContainerStyle,
  children,
}: SheetProps) {
  const insets = useSafeAreaInsets()
  const [triggerLayout, setTriggerLayout] = useState<TriggerLayout | null>(null)
  const [mounted, setMounted] = useState(false)
  const progress = useMemo(() => new Animated.Value(0), [])

  useEffect(() => {
    if (!visible) return
    void measureTrigger(triggerRef).then((measured) => {
      setTriggerLayout({
        ...measured,
        y: measured.y + getModalCoordinateOffset(),
      })
      setMounted(true)
      progress.setValue(0)
      Animated.timing(progress, {
        toValue: 1,
        duration: OPEN_DURATION,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start()
    })
  }, [visible, triggerRef, progress])

  const handleClose = useCallback(() => {
    Animated.timing(progress, {
      toValue: 0,
      duration: CLOSE_DURATION,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setMounted(false)
      setTriggerLayout(null)
      onClose()
    })
  }, [progress, onClose])

  useEffect(() => {
    if (!visible && mounted) handleClose()
  }, [visible, mounted, handleClose])

  if (!mounted || !triggerLayout) return null

  const computed = computeLayout(layout, triggerLayout, insets)
  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.9, 1],
  })
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [computed.translateFrom, 0],
  })

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={handleClose}
    >
      <Animated.View style={[styles.backdrop, { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
      </Animated.View>
      <Animated.View
        style={[
          styles.sheet,
          {
            top: computed.top,
            bottom: computed.bottom,
            left: computed.left,
            width: computed.width,
            maxHeight: computed.maxHeight,
            transformOrigin: computed.transformOrigin,
            opacity: progress,
            transform: [{ scale }, { translateY }],
          },
        ]}
      >
        {title ? (
          <View style={styles.header}>
            {IconComponent ? <IconComponent size={18} color={iconColor} weight="duotone" /> : null}
            <Text style={styles.title}>{title}</Text>
          </View>
        ) : null}
        <ScrollView
          contentContainerStyle={[styles.content, contentContainerStyle]}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {children}
        </ScrollView>
      </Animated.View>
    </Modal>
  )
}

interface EdgeDrawerProps {
  visible: boolean
  triggerRef: React.RefObject<View | null>
  onClose: () => void
  /** Which edge the drawer opens from. `auto` picks the edge nearest the trigger. */
  edge?: 'auto' | 'top' | 'bottom'
  title?: string
  /** Optional glyph shown left of a centred title. */
  icon?: Icon
  iconColor?: string
  /** Scroll newly expanded content into view when the drawer grows. */
  autoScrollOnContentExpand?: boolean
  /** Bring one child into the initially visible drawer area after opening. */
  initialFocusRef?: React.RefObject<View | null>
  /** Called after scrolling settles near the end of the drawer content. */
  onReachContentEnd?: () => void
  contentEndThreshold?: number
  backdropTestID?: string
  children: React.ReactNode
}

/**
 * A full-width edge drawer, dismissed by dragging it back toward the edge it opened from. It comes
 * from the bottom unless told otherwise: that is where a thumb rests, and top drawers are the rare
 * exception rather than something every caller should have to opt out of.
 */
// Reanimated shared values are mutable handles by design. React's immutability
// lint cannot distinguish their UI-thread writes from React-owned state.
/* eslint-disable react-hooks/immutability */
export function EdgeDrawer({
  visible,
  triggerRef,
  onClose,
  edge = 'bottom',
  title,
  icon: IconComponent,
  iconColor = theme.palette.slate.textSecondary,
  autoScrollOnContentExpand = false,
  initialFocusRef,
  onReachContentEnd,
  contentEndThreshold = 80,
  backdropTestID,
  children,
}: EdgeDrawerProps) {
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

  if (!mounted) return null

  const edgePadding = opensFromTop
    ? insets.top
    : insets.bottom + DRAWER_BOTTOM_CONTENT_PADDING + keyboardInset
  const emptyDismissArea = <Pressable style={{ height }} onPress={close} accessible={false} />

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={close}
      onShow={startOpen}
    >
      <GestureHandlerRootView style={styles.modalGestureRoot}>
        <View style={styles.drawer}>
          <Reanimated.View style={[StyleSheet.absoluteFill, styles.drawerScrim, backdropStyle]}>
            <Pressable testID={backdropTestID} style={StyleSheet.absoluteFill} onPress={close} />
          </Reanimated.View>
        </View>
        <Reanimated.View style={[styles.drawer, presenceStyle]}>
          <NativeScrollGestureContext.Provider value={nativeScrollGesture}>
            <GestureDetector gesture={nativeScrollGesture}>
              <Reanimated.ScrollView
                ref={scrollRef}
                onContentSizeChange={handleContentSizeChange}
                onScroll={scrollHandler}
                onScrollEndDrag={handleScrollEndDrag}
                onMomentumScrollEnd={handleScrollEnd}
                scrollEnabled={!closing}
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}
                bounces={false}
                overScrollMode="never"
              >
                {!opensFromTop ? emptyDismissArea : null}
                <View
                  style={[
                    styles.drawerBody,
                    opensFromTop ? { paddingTop: edgePadding } : { paddingBottom: edgePadding },
                  ]}
                >
                  {!opensFromTop ? <View style={styles.grabber} /> : null}
                  {title ? (
                    <Pressable
                      style={styles.drawerHeader}
                      onPress={close}
                      accessibilityRole="button"
                      accessibilityLabel={`Close ${title}`}
                    >
                      {IconComponent ? (
                        <IconComponent size={28} color={iconColor} weight="duotone" />
                      ) : null}
                      <Text style={styles.drawerTitle}>{title}</Text>
                    </Pressable>
                  ) : null}
                  <EdgeDrawerScrollContext.Provider value={scrollToOpenEdge}>
                    <View style={styles.drawerContent}>{children}</View>
                  </EdgeDrawerScrollContext.Provider>
                  {opensFromTop ? <View style={styles.grabber} /> : null}
                </View>
                {opensFromTop ? emptyDismissArea : null}
              </Reanimated.ScrollView>
            </GestureDetector>
          </NativeScrollGestureContext.Provider>
        </Reanimated.View>
      </GestureHandlerRootView>
    </Modal>
  )
}
/* eslint-enable react-hooks/immutability */

interface FloatingSheetProps {
  visible: boolean
  triggerRef: React.RefObject<View | null>
  onClose: () => void
  matchTriggerWidth?: boolean
  minWidth?: number
  title?: string
  contentContainerStyle?: StyleProp<ViewStyle>
  children: React.ReactNode
}

/**
 * A compact popover that floats centered under (or above, if short on space)
 * its trigger — same translucent/animated feel as {@link EdgeDrawer}, sized
 * to its content instead of growing from a screen corner.
 */
export function FloatingSheet({
  matchTriggerWidth = true,
  minWidth,
  ...props
}: FloatingSheetProps) {
  return <Sheet {...props} layout={{ mode: 'floating', matchTriggerWidth, minWidth }} />
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: theme.alpha(theme.palette.mono.black, 0.3),
  },
  sheet: {
    position: 'absolute',
    backgroundColor: theme.neutral.bg,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
  },
  title: {
    color: theme.neutral.textPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
  content: {
    padding: 12,
    gap: 12,
  },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  modalGestureRoot: {
    flex: 1,
  },
  /**
   * A flat translucent scrim rather than a vignette gradient. The gradient was there to fake a panel
   * edge, but its falloff never lined up with where the drawer actually ended, and the dismissal
   * fade is what conveys the drawer leaving.
   */
  drawerScrim: {
    backgroundColor: theme.neutral.bg,
  },
  drawerBody: {
    paddingHorizontal: 12,
    gap: 10,
  },
  drawerHeader: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 16,
  },
  drawerTitle: {
    color: theme.neutral.textPrimary,
    fontSize: 22,
    fontWeight: '300',
  },
  drawerContent: {
    gap: 12,
  },
  grabber: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: theme.neutral.textMuted,
    marginVertical: 3,
  },
})
