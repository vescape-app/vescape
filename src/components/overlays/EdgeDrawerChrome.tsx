import { useMemo } from 'react'
import {
  StyleSheet,
  useWindowDimensions,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler'
import Reanimated, {
  type SharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import {
  edgeDrawerRestoreOffset,
  edgeDrawerStickyShift,
} from '@/components/overlays/edgeDrawerDismiss'
import { theme } from '@/constants/theme'

/** How far chrome must be dragged toward the drawer's edge to close it. */
const CHROME_DISMISS_DISTANCE = 80
/** Release speed toward the edge (points/s) that closes from a shorter chrome drag. */
const CHROME_DISMISS_VELOCITY = 800
const CHROME_SETTLE_DURATION = 170
/** Height of the touch strip around the grabber. */
const GRAB_ZONE_HEIGHT = 40
/** Pinned distance over which the chrome backing fades in, so resting chrome stays clear. */
const STICKY_BACKING_FADE = 12

interface ChromeLayout {
  opensFromTop: boolean
  scrollOffset: SharedValue<number>
  dismissRange: SharedValue<number>
  edgePadding: number
  chromeDrag: SharedValue<number>
  dismissTriggered: SharedValue<boolean>
  nativeScrollGesture: GestureType
  close: () => void
}

/**
 * Keeps an edge drawer's chrome on screen while long content scrolls. The leading chrome (grabber
 * and header of a bottom drawer, header of a top one) pins below the status bar; the trailing
 * chrome (sticky footer, a top drawer's grabber) pins above the bottom safe area. Dragging the
 * grabber toward the drawer's edge closes it from any scroll position.
 */
export function useEdgeDrawerChrome({
  opensFromTop,
  scrollOffset,
  dismissRange,
  edgePadding,
  chromeDrag,
  dismissTriggered,
  nativeScrollGesture,
  close,
}: ChromeLayout) {
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const leadingHeight = useSharedValue(0)
  const trailingHeight = useSharedValue(0)
  // Chrome sits at fixed distances from the content ends: the dismiss area on one side, the safe
  // edge padding on the other. A top drawer's header carries the status-bar padding itself.
  const leadingStart = opensFromTop ? 0 : height
  const leadingPin = opensFromTop ? 0 : insets.top
  const trailingEndGap = opensFromTop ? height : edgePadding
  const trailingPin = height - (opensFromTop ? insets.bottom : edgePadding)

  // Pinning holds chrome over content still on screen. Past the content edge the drawer is being
  // dismissed, and its chrome must leave with it rather than stay pinned to the screen.
  const contentOffset = useDerivedValue(() => {
    const edge = edgeDrawerRestoreOffset(dismissRange.value, height, opensFromTop)
    return opensFromTop ? Math.min(scrollOffset.value, edge) : Math.max(scrollOffset.value, edge)
  })
  const leadingShift = useDerivedValue(() => {
    const trailingStart = dismissRange.value + height - trailingEndGap - trailingHeight.value
    return edgeDrawerStickyShift({
      offset: contentOffset.value,
      start: leadingStart,
      pinAt: leadingPin,
      maxShift: trailingStart - leadingStart - leadingHeight.value,
    })
  })
  const trailingShift = useDerivedValue(() => {
    const trailingEnd = dismissRange.value + height - trailingEndGap
    return edgeDrawerStickyShift({
      offset: contentOffset.value,
      end: trailingEnd,
      pinAt: trailingPin,
      maxShift: trailingEnd - trailingHeight.value - leadingStart - leadingHeight.value,
    })
  })

  const dismissSign = opensFromTop ? -1 : 1
  const grabGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(dismissSign * 8)
        .failOffsetY(-dismissSign * 8)
        .blocksExternalGesture(nativeScrollGesture)
        .onUpdate((event) => {
          chromeDrag.set(Math.max(0, event.translationY * dismissSign) * dismissSign)
        })
        .onEnd((event) => {
          const distance = chromeDrag.value * dismissSign
          const speed = event.velocityY * dismissSign
          if (distance > CHROME_DISMISS_DISTANCE || speed > CHROME_DISMISS_VELOCITY) {
            dismissTriggered.set(true)
            scheduleOnRN(close)
            return
          }
          chromeDrag.set(withTiming(0, { duration: CHROME_SETTLE_DURATION }))
        }),
    [chromeDrag, close, dismissSign, dismissTriggered, nativeScrollGesture],
  )
  // The grabber leads a bottom drawer's chrome and trails a top drawer's. Its strip tracks where
  // the grabber is drawn on screen, pinned or not.
  const grabZoneStyle = useAnimatedStyle(() => {
    const top = opensFromTop
      ? dismissRange.value +
        height -
        trailingEndGap -
        scrollOffset.value +
        trailingShift.value -
        GRAB_ZONE_HEIGHT * 0.7
      : leadingStart - scrollOffset.value + leadingShift.value - GRAB_ZONE_HEIGHT * 0.3
    return { transform: [{ translateY: top }] }
  })

  // Screen position of each chrome, for drawers that draw it over the list instead of inside it.
  const leadingTop = useDerivedValue(() => leadingStart - contentOffset.value + leadingShift.value)
  const trailingTop = useDerivedValue(
    () =>
      dismissRange.value +
      height -
      trailingEndGap -
      contentOffset.value +
      trailingShift.value -
      trailingHeight.value,
  )

  return {
    leading: {
      screenTop: leadingTop,
      shift: leadingShift,
      heightValue: leadingHeight,
      bleed: { top: leadingPin, bottom: 0 },
    },
    trailing: {
      screenTop: trailingTop,
      shift: trailingShift,
      heightValue: trailingHeight,
      bleed: { top: 0, bottom: height - trailingPin },
    },
    grabZone: { gesture: grabGesture, style: grabZoneStyle },
  }
}

/**
 * Touch strip over the grabber, outside the scroll view. Chrome pinned by a transform has scrolled
 * its layout box away, and Android routes touches by layout box, so the strip carries the drag.
 */
export function GrabZone({
  gesture,
  style,
  testID,
}: ReturnType<typeof useEdgeDrawerChrome>['grabZone'] & { testID?: string }) {
  return (
    <GestureDetector gesture={gesture}>
      <Reanimated.View testID={testID} accessible={false} style={[styles.grabZone, style]} />
    </GestureDetector>
  )
}

/**
 * Drawer chrome that follows the scroll to stay on screen. Pinned over scrolling content it gains
 * a backing that bleeds into the safe area, so rows never show through around it.
 */
export function StickyChrome({
  screenTop,
  shift,
  heightValue,
  bleed,
  background,
  overlay = false,
  onHeight,
  style,
  children,
}: ReturnType<typeof useEdgeDrawerChrome>['leading'] & {
  background: string
  /** Draw over the scroll view at its screen position instead of scrolling inside it. */
  overlay?: boolean
  onHeight?: (height: number) => void
  style?: StyleProp<ViewStyle>
  children: React.ReactNode
}) {
  const onLayout = (event: LayoutChangeEvent) => {
    heightValue.set(event.nativeEvent.layout.height)
    onHeight?.(event.nativeEvent.layout.height)
  }
  const shiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: overlay ? screenTop.value : shift.value }],
  }))
  const backingStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.abs(shift.value) / STICKY_BACKING_FADE),
  }))
  return (
    <Reanimated.View
      pointerEvents="box-none"
      style={[styles.chrome, overlay && styles.overlay, style, shiftStyle]}
      onLayout={onLayout}
    >
      <Reanimated.View
        pointerEvents="none"
        style={[
          styles.backing,
          {
            top: -bleed.top,
            bottom: -bleed.bottom,
            backgroundColor: theme.alpha(background, 0.85),
          },
          backingStyle,
        ]}
      />
      {children}
    </Reanimated.View>
  )
}

const styles = StyleSheet.create({
  chrome: {
    zIndex: 1,
    gap: 10,
    marginHorizontal: -12,
    paddingHorizontal: 12,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 12,
    right: 12,
    marginHorizontal: 0,
  },
  grabZone: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: GRAB_ZONE_HEIGHT,
  },
  backing: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
})
