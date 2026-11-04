import { type ComponentProps, useEffect, useState } from 'react'
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import NativeMarkerView from '@rnmapbox/maps/lib/module/specs/RNMBXMarkerViewNativeComponent'
import NativeMarkerContent from '@rnmapbox/maps/lib/module/specs/RNMBXMarkerViewContentNativeComponent'

import { GpsPuck } from './GpsPuck'
import { startPointAnimation } from '@/modules/map/lib/liveMotion/pointAnimation'
import type { MotionDisplayRuntime } from '@/modules/map/lib/liveMotion/display'

const AnimatedMarker = Animated.createAnimatedComponent(NativeMarkerView)

/**
 * Non-interactive view annotation: the UI thread interpolates native-authored segments.
 * Use the native host directly because MarkerView's JS wrapper has no forwarded ref and
 * sends annotation-position events into React for touch hit testing. This puck has no touches.
 */
export function MotionPuck({
  displayRuntime,
  fallbackCoordinate,
  ...puck
}: ComponentProps<typeof GpsPuck> & {
  displayRuntime: MotionDisplayRuntime
  fallbackCoordinate: [number, number]
}) {
  const [initialCoordinate] = useState(
    () => displayRuntime.motion.position(displayRuntime.now()) ?? fallbackCoordinate,
  )
  const coordinate = useSharedValue(initialCoordinate)
  const animatedProps = useAnimatedProps(() => ({ coordinate: coordinate.value }))
  useEffect(() => {
    if (!displayRuntime.motion.position(displayRuntime.now())) coordinate.set(fallbackCoordinate)
  }, [coordinate, displayRuntime, fallbackCoordinate])
  useEffect(
    () =>
      startPointAnimation({
        motion: displayRuntime.motion,
        subscribe: displayRuntime.subscribe,
        now: displayRuntime.now,
        isActive: () => displayRuntime.active,
        moveTo: (target, durationMs) => {
          coordinate.set(
            durationMs > 0
              ? withTiming(target, {
                  duration: displayRuntime.duration(durationMs),
                  easing: Easing.linear,
                })
              : target,
          )
        },
        schedule: (callback, ms) => setTimeout(callback, displayRuntime.duration(ms)),
        cancel: clearTimeout,
      }),
    [coordinate, displayRuntime],
  )
  return (
    <AnimatedMarker
      coordinate={initialCoordinate}
      animatedProps={animatedProps}
      anchor={{ x: 0.5, y: 0.5 }}
      allowOverlap
      allowOverlapWithPuck
      isSelected={false}
      pointerEvents="none"
      style={{ position: 'absolute' }}
    >
      <NativeMarkerContent collapsable={false} style={{ flex: 0, alignSelf: 'flex-start' }}>
        <GpsPuck {...puck} />
      </NativeMarkerContent>
    </AnimatedMarker>
  )
}
