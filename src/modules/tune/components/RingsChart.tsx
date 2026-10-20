import { use, useEffect } from 'react'
import { View, useWindowDimensions } from 'react-native'
import Svg, { Circle, Defs, Line } from 'react-native-svg'
import { Gesture, GestureDetector, type NativeGesture } from 'react-native-gesture-handler'
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { impactAsync, ImpactFeedbackStyle } from 'expo-haptics'
import { Text } from '@/components/base/Text'
import { RingParameterLabel } from './RingParameterLabel'
import { TuneRingGradient } from './TuneRingGradient'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import type { RefObject } from 'react'
import type { projectRingControl } from '../lib/ringModel'
import { NativeScrollGestureContext } from '@/components/gestures/NativeScrollGestureContext'
import {
  ANGLES,
  constrainCircleEdit,
  handleCircle,
  radiusValue,
  valueRadius,
  ringPageRevealOffset,
} from '../lib/ringGeometry'

const AnimatedCircle = Animated.createAnimatedComponent(Circle)
let lastPulse = 0
function pulse() {
  const now = Date.now()
  if (now - lastPulse < 120) return
  lastPulse = now
  void impactAsync(ImpactFeedbackStyle.Soft)
}

export function RingsChart({
  values,
  savedValues,
  size,
  color,
  referenceColor,
  axisColors,
  disabled,
  onChange,
  position,
  section,
  pageWidth,
  scrollGesture,
  projections,
  onOpen,
  unavailable = false,
}: {
  values: number[]
  savedValues?: number[]
  size: number
  color: string
  referenceColor: string
  axisColors: string[]
  disabled: boolean
  onChange: (values: number[], axis: number | null) => boolean
  position: SharedValue<number>
  section: number
  pageWidth: number
  unavailable?: boolean
  projections?: ReturnType<typeof projectRingControl>[]
  onOpen?: (control: number, ref: RefObject<View | null>) => void
  scrollGesture?: NativeGesture
}) {
  'use no memo'
  const neutral = useResolvedNeutralColors()
  const pager = use(NativeScrollGestureContext)
  const live = useSharedValue(values)
  const moving = useSharedValue(false)
  const { fontScale } = useWindowDimensions()
  const plotTop = projections ? 65 * Math.max(1, fontScale) : 0
  const center = size / 2
  const radius = size * 0.36
  const labelWidth = Math.min(140, size / 2 - 8)
  const labelReserve = 110
  const initial = useSharedValue(handleCircle(values, radius, center))
  const start = useSharedValue({ x: 0, y: 0, distance: 0 })
  const mode = useSharedValue(-3) // -3 miss, -2 resize, -1 mix, 0..2 axis
  const original = useSharedValue(values)
  const activated = useSharedValue(false)
  const [first, second, third] = values
  useEffect(() => {
    live.set([first, second, third])
  }, [live, first, second, third])
  const commit = (next: number[], axis: number | null) => {
    // Keep the UI-thread result until the authoritative draft arrives. Only a
    // rejected or unchanged edit rolls back to the authoritative draft.
    if (!onChange(next.slice(0, 3), axis)) live.set(values)
  }
  const gesture = Gesture.Pan()
    .enabled(!disabled && !unavailable)
    .manualActivation(true)
    .onTouchesDown((event, manager) => {
      const rawTouch = event.allTouches[0]
      const touch = rawTouch ? { x: rawTouch.x, y: rawTouch.y - plotTop } : undefined
      if (!touch || event.numberOfTouches !== 1) {
        manager.fail()
        return
      }
      original.set([...live.value])
      const circle = handleCircle(live.value, radius, center)
      initial.set(circle)
      start.set({
        x: touch.x,
        y: touch.y,
        distance: Math.hypot(touch.x - circle.cx, touch.y - circle.cy),
      })
      let hit = -3
      for (let i = 0; i < 3; i++) {
        const r = valueRadius(live.value[i], radius)
        if (
          Math.hypot(
            touch.x - center - Math.cos(ANGLES[i]) * r,
            touch.y - center - Math.sin(ANGLES[i]) * r,
          ) < 24
        )
          hit = i
      }
      if (hit === -3 && start.value.distance < 22) hit = -1
      if (hit === -3 && Math.abs(start.value.distance - circle.r) < 12) hit = -2
      mode.set(hit)
      activated.set(false)
      if (hit === -3) manager.fail()
    })
    .onTouchesMove((event, manager) => {
      const rawTouch = event.allTouches[0]
      const touch = rawTouch ? { x: rawTouch.x, y: rawTouch.y - plotTop } : undefined
      if (!touch || event.numberOfTouches !== 1) {
        manager.fail()
        return
      }
      if (
        !activated.value &&
        Math.hypot(touch.x - start.value.x, touch.y - start.value.y) >= (mode.value === -2 ? 8 : 3)
      ) {
        // Rebase at activation: crossing the resize dead zone has zero size delta.
        start.set({
          x: touch.x,
          y: touch.y,
          distance: Math.hypot(touch.x - initial.value.cx, touch.y - initial.value.cy),
        })
        activated.set(true)
        manager.activate()
      }
    })
    .onStart(() => moving.set(true))
    .onUpdate((event) => {
      const dx = event.x - start.value.x
      const dy = event.y - plotTop - start.value.y
      let next: number[] | null
      if (mode.value >= 0) {
        const axis = mode.value
        const delta = Math.cos(ANGLES[axis]) * dx + Math.sin(ANGLES[axis]) * dy
        const percent = radiusValue(valueRadius(original.value[axis], radius) + delta, radius)
        next = original.value.map((v, i) => (i === axis ? Math.round(percent) : v))
      } else {
        const circle = initial.value
        const desired =
          mode.value === -1
            ? { ...circle, cx: circle.cx + dx, cy: circle.cy + dy }
            : {
                ...circle,
                r: Math.max(
                  1,
                  circle.r +
                    Math.hypot(event.x - circle.cx, event.y - plotTop - circle.cy) -
                    start.value.distance,
                ),
              }
        next = constrainCircleEdit(circle, desired, radius, center, [1, 1, 1], 0)
      }
      if (next && next.some((value, i) => Math.abs(value - live.value[i]) >= 1)) {
        live.set(next)
        scheduleOnRN(pulse)
      }
    })
    .onEnd((_event, success) => {
      if (success) scheduleOnRN(commit, [...live.value], mode.value >= 0 ? mode.value : null)
    })
    .onFinalize((_event, success) => {
      moving.set(false)
      if (!success) live.set(original.value)
      mode.set(-3)
    })
  if (pager) gesture.blocksExternalGesture(pager)
  if (scrollGesture) gesture.blocksExternalGesture(scrollGesture)
  const circleProps = useAnimatedProps(() => ({
    ...handleCircle(live.value, radius, center),
    strokeOpacity: moving.value && mode.value < 0 ? 1 : 0.5,
    fillOpacity: moving.value && mode.value < 0 ? 1 : 0.7,
    strokeWidth: moving.value && mode.value < 0 ? 2 : 1,
  }))
  const reference = useAnimatedProps(() => ({
    strokeOpacity: savedValues?.some((v, i) => Math.abs(v - live.value[i]) > 0.001) ? 0.4 : 0,
  }))
  const parallax = useAnimatedStyle(() => ({
    opacity: Math.max(0.4, 1 - Math.abs(position.value / pageWidth - section) * 0.6),
    transform: [
      {
        translateX:
          (position.value / pageWidth - section) * ringPageRevealOffset(pageWidth, radius),
      },
    ],
  }))
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={{
          width: size,
          height: projections
            ? plotTop +
              Math.max(size, center + radius * 0.5 + 20 + labelReserve * Math.max(1, fontScale))
            : size,
        }}
      >
        <Animated.View
          style={[{ marginTop: plotTop }, parallax]}
          accessible
          accessibilityRole="adjustable"
          accessibilityState={{ disabled: disabled || unavailable }}
          accessibilityLabel="Resize Rings circle. Precise axis editing is available beside the chart."
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => {
            if (disabled || unavailable) return
            const circle = handleCircle(values, radius, center)
            const next = constrainCircleEdit(
              circle,
              { ...circle, r: circle.r + (event.nativeEvent.actionName === 'increment' ? 3 : -3) },
              radius,
              center,
              [1, 1, 1],
              0,
            )
            if (next) onChange(next.slice(0, 3), null)
          }}
        >
          {!unavailable ? (
            <Svg width={size} height={size} pointerEvents="none">
              <Defs>
                <TuneRingGradient id={`rings-${section}`} color={color} />
              </Defs>
              <Circle
                cx={center}
                cy={center}
                r={valueRadius(50, radius)}
                fill="none"
                stroke={neutral.textDim}
                strokeWidth={valueRadius(75, radius) - valueRadius(25, radius)}
                strokeOpacity={0.1}
              />
              <Circle
                cx={center}
                cy={center}
                r={radius}
                fill={color}
                fillOpacity={0.03}
                stroke={neutral.textDim}
                strokeOpacity={0.65}
              />
              {[0, 25, 50, 75].map((v) => (
                <Circle
                  key={v}
                  cx={center}
                  cy={center}
                  r={valueRadius(v, radius)}
                  fill="none"
                  stroke={neutral.textDim}
                  strokeOpacity={0.65}
                />
              ))}
              {ANGLES.slice(0, 3).map((angle, i) => (
                <Line
                  key={angle}
                  x1={center + Math.cos(angle) * 28}
                  y1={center + Math.sin(angle) * 28}
                  x2={center + Math.cos(angle) * radius}
                  y2={center + Math.sin(angle) * radius}
                  stroke={axisColors[i]}
                  strokeOpacity={0.65}
                  strokeWidth={1.5}
                  strokeDasharray="2 5"
                />
              ))}
              {savedValues ? (
                <AnimatedCircle
                  animatedProps={reference}
                  {...handleCircle(savedValues, radius, center)}
                  fill="none"
                  stroke={referenceColor}
                  strokeDasharray="4 6"
                />
              ) : null}
              <AnimatedCircle
                animatedProps={circleProps}
                fill={`url(#rings-${section})`}
                stroke={color}
                strokeWidth={2}
              />
              {[0, 1, 2].map((axis) => (
                <LiveHandle
                  key={axis}
                  live={live}
                  mode={mode}
                  axis={axis}
                  center={center}
                  radius={radius}
                  color={axisColors[axis]}
                />
              ))}
              <MixHandle live={live} center={center} radius={radius} color={color} />
            </Svg>
          ) : (
            <View
              style={{
                width: size,
                height: size,
                alignItems: 'center',
                justifyContent: 'center',
                padding: 48,
              }}
            >
              <Text style={{ color: neutral.textMuted, textAlign: 'center' }}>
                Missing settings. Check Advanced.
              </Text>
            </View>
          )}
        </Animated.View>
        {projections && onOpen
          ? [0, 1, 2].map((index) => (
              <RingParameterLabel
                key={index}
                control={section * 3 + index}
                projection={projections[index]}
                liveValues={live}
                index={index}
                color={axisColors[index]}
                disabled={disabled}
                onOpen={onOpen}
                style={
                  index === 0
                    ? { top: 0, left: (size - 220) / 2, width: 220 }
                    : {
                        top: plotTop + center + radius * 0.5 + 20,
                        left: index === 1 ? 0 : size - labelWidth,
                        width: labelWidth,
                      }
                }
              />
            ))
          : null}
      </Animated.View>
    </GestureDetector>
  )
}
function LiveHandle({
  live,
  mode,
  axis,
  center,
  radius,
  color,
}: {
  live: SharedValue<number[]>
  mode: SharedValue<number>
  axis: number
  center: number
  radius: number
  color: string
}) {
  'use no memo'
  const neutral = useResolvedNeutralColors()
  const props = useAnimatedProps(() => ({
    fill: mode.value === axis ? color : neutral.surfaceDeep,
    cx: center + Math.cos(ANGLES[axis]) * valueRadius(live.value[axis], radius),
    cy: center + Math.sin(ANGLES[axis]) * valueRadius(live.value[axis], radius),
  }))
  return <AnimatedCircle animatedProps={props} r={10} stroke={color} strokeWidth={2} />
}
function MixHandle({
  live,
  center,
  radius,
  color,
}: {
  live: SharedValue<number[]>
  center: number
  radius: number
  color: string
}) {
  'use no memo'
  const props = useAnimatedProps(() => {
    const circle = handleCircle(live.value, radius, center)
    return { cx: circle.cx, cy: circle.cy }
  })
  return <AnimatedCircle animatedProps={props} r={5} fill={color} />
}
