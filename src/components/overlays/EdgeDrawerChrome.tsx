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

const CHROME_DISMISS_DISTANCE = 80
const CHROME_DISMISS_VELOCITY = 800
const CHROME_SETTLE_DURATION = 170
const GRAB_ZONE_HEIGHT = 40
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
  const leadingStart = opensFromTop ? 0 : height
  const leadingPin = opensFromTop ? 0 : insets.top
  const trailingEndGap = opensFromTop ? height : edgePadding
  const trailingPin = height - (opensFromTop ? insets.bottom : edgePadding)

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
