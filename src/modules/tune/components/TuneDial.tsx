/* eslint-disable react-hooks/immutability, react-hooks/refs */
import * as Haptics from 'expo-haptics'
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, {
  cancelAnimation,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withSpring,
  type FrameCallback,
} from 'react-native-reanimated'
import {
  Canvas,
  DashPathEffect,
  Group,
  Line,
  LinearGradient,
  Path,
  Rect,
  Skia,
  Text as SkiaText,
  vec,
} from '@shopify/react-native-skia'
import { scheduleOnRN } from 'react-native-worklets'

import {
  DRAG_RANGE_GAIN,
  THROW_STOP_VELOCITY,
  advanceTuneDialThrow,
  computeHapticStepSpacing,
  computeTuneDialLayout,
  isTuneDialEdgeStep,
  resolveTuneDialThrowTargetOffset,
  resolveTuneDialThrowVelocity,
  shouldApplyExternalTuneDialValue,
  shouldPlayTuneDialHaptic,
} from '@/modules/tune/components/tuneDialPhysics'
import { NativeScrollGestureContext } from '@/components/gestures/NativeScrollGestureContext'
import { useSkiaFont } from '@/hooks/useSkiaFont'
import { theme } from '@/constants/theme'
import { formatTuneValue } from '@/modules/tune/lib/fields'

const DIAL_HEIGHT = 105
const TOP_VALUE_BAND_HEIGHT = 22
const MAJOR_TICK_TOP = TOP_VALUE_BAND_HEIGHT + 5
const RULER_LABEL_BAND_TOP = 76
const VALUE_LABEL_HEIGHT = 14
const CURRENT_VALUE_TOP = 2
const MARKER_LINE_WIDTH = 2.5
const GLOW_WIDTH = 52
const LABEL_FONT_SIZE = 9
const BADGE_FONT_SIZE = 18
const BADGE_WIDTH = 80
const BADGE_BASELINE = 17
const LABEL_BASELINE_Y = RULER_LABEL_BAND_TOP + (VALUE_LABEL_HEIGHT + LABEL_FONT_SIZE) / 2 - 1.5
const PREV_MARK_COLOR = theme.palette.yellow.color
const MAJOR_TICK_COLOR = theme.palette.slate.textMuted
const MINOR_TICK_COLOR = theme.palette.slate.border
const LABEL_COLOR = theme.palette.slate.textMuted

const SNAP_SPRING = { damping: 18, stiffness: 700, mass: 0.8 }

interface TuneDialProps {
  value: number
  previousValue?: number
  min: number
  max: number
  step: number
  unit?: string | null
  indicatorGlow?: 'left' | 'right'
  valueChangeMode?: 'live' | 'commit'
  color?: string
  onValueChange: (value: number) => void
}

function formatDisplayValue(value: number, decimals: number): string {
  'worklet'

  if (decimals <= 0) return String(Math.round(value))
  return value.toFixed(decimals)
}

export function TuneDial({
  value,
  previousValue,
  min,
  max,
  step,
  unit,
  indicatorGlow,
  valueChangeMode = 'commit',
  color = theme.telemetry.speed,
  onValueChange,
}: TuneDialProps) {
  'use no memo'
  const nativeScrollGesture = use(NativeScrollGestureContext)
  const range = max - min
  const {
    totalSteps,
    totalWidth,
    stepPx,
    majorEvery,
    minorEvery,
    renderMinor,
    labelEveryStep,
    renderMidpointTicks,
  } = useMemo(() => computeTuneDialLayout(min, max, step), [min, max, step])
  const hapticStepSpacing = computeHapticStepSpacing()
  const initialStepIndex = Math.round((value - min) / step)
  const decimals = step < 1 ? Math.ceil(Math.abs(Math.log10(step))) : 0
  const commitEveryChange = valueChangeMode === 'live'

  const valueToOffset = useCallback(
    (v: number) => ((v - min) / range) * totalWidth,
    [min, range, totalWidth],
  )

  const translateX = useSharedValue(-valueToOffset(value))
  const dragStartX = useSharedValue(0)
  const interactionActive = useSharedValue(false)
  const momentumVelocity = useSharedValue(0)
  const momentumTargetOffset = useSharedValue(0)
  const displayValue = useSharedValue(value)
  const lastEmittedValue = useSharedValue(value)
  const lastStepIndex = useSharedValue(initialStepIndex)
  const lastEdgeHapticStepIndex = useSharedValue(-1)
  const momentumFrameRef = useRef<FrameCallback | null>(null)

  const setMomentumFrameActive = useCallback((active: boolean) => {
    momentumFrameRef.current?.setActive(active)
  }, [])

  const tick = useCallback(() => {
    if (Platform.OS === 'ios') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    } else if (Platform.OS === 'android') {
      void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Clock_Tick)
    }
  }, [])

  const edgeTick = useCallback(() => {
    if (Platform.OS === 'ios') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
    } else if (Platform.OS === 'android') {
      void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Long_Press)
    }
  }, [])

  const emitEdgeHaptic = useCallback(
    (stepIndex: number) => {
      'worklet'
      if (stepIndex !== 0 && stepIndex !== totalSteps) {
        lastEdgeHapticStepIndex.value = -1
        return
      }

      if (lastEdgeHapticStepIndex.value === stepIndex) return

      lastEdgeHapticStepIndex.value = stepIndex
      scheduleOnRN(edgeTick)
    },
    [edgeTick, lastEdgeHapticStepIndex, totalSteps],
  )

  const emitStepIndex = useCallback(
    (rawStepIndex: number, shouldTick = true) => {
      'worklet'
      const stepIndex = Math.max(0, Math.min(totalSteps, rawStepIndex))
      const snappedRaw = Math.round((min + stepIndex * step - min) / step) * step + min
      const snapped = Number(Math.max(min, Math.min(max, snappedRaw)).toFixed(decimals))
      const previousStepIndex = lastStepIndex.value
      lastStepIndex.value = stepIndex
      if (stepIndex !== 0 && stepIndex !== totalSteps) {
        lastEdgeHapticStepIndex.value = -1
      }
      if (snapped !== displayValue.value) {
        displayValue.value = snapped
        if (isTuneDialEdgeStep(stepIndex, totalSteps)) {
          emitEdgeHaptic(stepIndex)
        } else if (
          shouldTick &&
          shouldPlayTuneDialHaptic(previousStepIndex, stepIndex, hapticStepSpacing)
        ) {
          scheduleOnRN(tick)
        }
      }
      if (commitEveryChange && snapped !== lastEmittedValue.value) {
        lastEmittedValue.value = snapped
        scheduleOnRN(onValueChange, snapped)
      }
      return snapped
    },
    [
      commitEveryChange,
      decimals,
      displayValue,
      hapticStepSpacing,
      emitEdgeHaptic,
      lastEdgeHapticStepIndex,
      lastEmittedValue,
      lastStepIndex,
      min,
      max,
      step,
      totalSteps,
      onValueChange,
      tick,
    ],
  )

  const commitStepIndex = useCallback(
    (rawStepIndex: number) => {
      'worklet'
      const snapped = emitStepIndex(rawStepIndex)
      if (snapped !== lastEmittedValue.value) {
        lastEmittedValue.value = snapped
        scheduleOnRN(onValueChange, snapped)
      }
      return snapped
    },
    [emitStepIndex, lastEmittedValue, onValueChange],
  )

  const settleOffsetToNearest = useCallback(
    (rawOffset: number) => {
      'worklet'
      const stepIndex = Math.max(0, Math.min(totalSteps, Math.round(-rawOffset / stepPx)))
      commitStepIndex(stepIndex)
      translateX.value = withSpring(-stepIndex * stepPx, SNAP_SPRING, (finished) => {
        if (finished) interactionActive.value = false
      })
    },
    [commitStepIndex, interactionActive, stepPx, totalSteps, translateX],
  )

  const pauseThrow = useCallback(() => {
    'worklet'
    cancelAnimation(translateX)
    momentumVelocity.value = 0
  }, [momentumVelocity, translateX])

  const handleMomentumFrame = useCallback(
    (frame: { timeSincePreviousFrame: number | null }) => {
      'worklet'
      const rawDt = frame.timeSincePreviousFrame ?? 16
      const speed = Math.abs(momentumVelocity.value)

      if (speed <= THROW_STOP_VELOCITY) {
        if (speed > 0) {
          momentumVelocity.value = 0
          settleOffsetToNearest(momentumTargetOffset.value)
        }
        scheduleOnRN(setMomentumFrameActive, false)
        return
      }

      const nextThrow = advanceTuneDialThrow(momentumVelocity.value, rawDt)
      let nextOffset = translateX.value + nextThrow.distance
      const reachedTarget =
        momentumVelocity.value < 0
          ? nextOffset <= momentumTargetOffset.value
          : nextOffset >= momentumTargetOffset.value
      if (reachedTarget) {
        momentumVelocity.value = 0
        settleOffsetToNearest(momentumTargetOffset.value)
        scheduleOnRN(setMomentumFrameActive, false)
        return
      }
      if (nextOffset > 0 || nextOffset < -totalWidth) {
        nextOffset = Math.max(-totalWidth, Math.min(0, nextOffset))
        momentumVelocity.value = 0
        const edgeStepIndex = Math.max(0, Math.min(totalSteps, Math.round(-nextOffset / stepPx)))
        translateX.value = withSpring(-edgeStepIndex * stepPx, SNAP_SPRING, (finished) => {
          if (finished) interactionActive.value = false
        })
        commitStepIndex(edgeStepIndex)
        emitEdgeHaptic(edgeStepIndex)
        scheduleOnRN(setMomentumFrameActive, false)
        return
      }

      momentumVelocity.value = nextThrow.velocity
      const nearestStepIndex = Math.max(0, Math.min(totalSteps, Math.round(-nextOffset / stepPx)))
      translateX.value = nextOffset
      emitStepIndex(nearestStepIndex, true)
    },
    [
      emitEdgeHaptic,
      emitStepIndex,
      commitStepIndex,
      interactionActive,
      momentumTargetOffset,
      momentumVelocity,
      setMomentumFrameActive,
      settleOffsetToNearest,
      stepPx,
      totalSteps,
      totalWidth,
      translateX,
    ],
  )

  const momentumFrame = useFrameCallback(handleMomentumFrame, false)

  useEffect(() => {
    momentumFrameRef.current = momentumFrame
    return () => {
      if (momentumFrameRef.current === momentumFrame) {
        momentumFrameRef.current = null
      }
    }
  }, [momentumFrame])

  const panGesture = useMemo(() => {
    const gesture = Gesture.Pan()
      .activeOffsetX([-8, 8])
      .onTouchesDown(() => {
        pauseThrow()
      })
      .onStart(() => {
        pauseThrow()
        interactionActive.value = true
        dragStartX.value = translateX.value
        lastStepIndex.value = Math.max(
          0,
          Math.min(totalSteps, Math.round(-translateX.value / stepPx)),
        )
      })
      .onUpdate((e) => {
        const raw = dragStartX.value + e.translationX * DRAG_RANGE_GAIN
        const clamped = Math.max(-totalWidth, Math.min(0, raw))
        translateX.value = clamped
        const stepIndex = Math.max(0, Math.min(totalSteps, Math.round(-clamped / stepPx)))
        emitStepIndex(stepIndex)
        if (raw > 0 || raw < -totalWidth) {
          emitEdgeHaptic(stepIndex)
        }
      })
      .onEnd((e) => {
        momentumVelocity.value = resolveTuneDialThrowVelocity(e.velocityX, e.translationX)
        if (momentumVelocity.value === 0) {
          settleOffsetToNearest(translateX.value)
        } else {
          const rawTargetOffset = resolveTuneDialThrowTargetOffset(
            translateX.value,
            momentumVelocity.value,
            totalWidth,
          )
          const targetStepIndex = Math.max(
            0,
            Math.min(totalSteps, Math.round(-rawTargetOffset / stepPx)),
          )
          momentumTargetOffset.value = -targetStepIndex * stepPx
          if (!commitEveryChange) commitStepIndex(targetStepIndex)
          scheduleOnRN(setMomentumFrameActive, true)
          const stepIndex = Math.max(
            0,
            Math.min(totalSteps, Math.round(-translateX.value / stepPx)),
          )
          emitStepIndex(stepIndex)
        }
      })
      .onFinalize((_e, success) => {
        if (!success && interactionActive.value) {
          settleOffsetToNearest(translateX.value)
        }
      })

    if (nativeScrollGesture) gesture.blocksExternalGesture(nativeScrollGesture)
    return gesture
  }, [
    dragStartX,
    emitStepIndex,
    emitEdgeHaptic,
    interactionActive,
    commitEveryChange,
    commitStepIndex,
    momentumTargetOffset,
    momentumVelocity,
    pauseThrow,
    settleOffsetToNearest,
    stepPx,
    totalSteps,
    totalWidth,
    translateX,
    lastStepIndex,
    nativeScrollGesture,
    setMomentumFrameActive,
  ])

  useEffect(() => {
    if (!shouldApplyExternalTuneDialValue(value, lastEmittedValue.value, interactionActive.value)) {
      return
    }

    const expectedOffset = -valueToOffset(value)
    if (Math.abs(translateX.value - expectedOffset) > stepPx * 0.3) {
      lastEmittedValue.value = value
      displayValue.value = value
      lastStepIndex.value = Math.round((value - min) / step)
      momentumVelocity.value = 0
      translateX.value = withSpring(expectedOffset, SNAP_SPRING)
    }
  }, [
    min,
    interactionActive,
    momentumVelocity,
    step,
    value,
    valueToOffset,
    translateX,
    stepPx,
    lastEmittedValue,
    displayValue,
    lastStepIndex,
  ])

  const [canvasWidth, setCanvasWidth] = useState(0)
  const centerX = canvasWidth / 2

  const stripTransform = useDerivedValue(() => [{ translateX: centerX + translateX.value }])

  const prevMarkOffset = previousValue != null ? valueToOffset(previousValue) : null
  const previousValueLabel = previousValue != null ? formatTuneValue(previousValue) : null

  const badgeFont = useSkiaFont('800', BADGE_FONT_SIZE)
  const badgeText = useDerivedValue(() => formatDisplayValue(displayValue.value, decimals))
  const badgeX = useDerivedValue(() =>
    badgeFont ? BADGE_WIDTH - badgeFont.getTextWidth(badgeText.value) : 0,
  )

  const labelFont = useSkiaFont('700', LABEL_FONT_SIZE)
  const prevLabelFont = useSkiaFont('800', LABEL_FONT_SIZE)

  const { majorTicksPath, minorTicksPath, labels } = useMemo(() => {
    const majorPath = Skia.Path.Make()
    const minorPath = Skia.Path.Make()
    const labelList: { key: number; text: string; x: number }[] = []

    for (let i = 0; i <= totalSteps; i++) {
      const val = Number((min + i * step).toFixed(decimals))
      const x = i * stepPx
      const isMajor = labelEveryStep || i % majorEvery === 0
      const isMinor = !isMajor && renderMinor && i % minorEvery === 0

      if (isMajor) {
        majorPath.moveTo(x, MAJOR_TICK_TOP)
        majorPath.lineTo(x, RULER_LABEL_BAND_TOP)
        const text = formatTuneValue(val)
        const textX = labelFont ? x - labelFont.getTextWidth(text) / 2 : x
        labelList.push({ key: i, text, x: textX })
      } else if (isMinor) {
        minorPath.moveTo(x, TOP_VALUE_BAND_HEIGHT + 9)
        minorPath.lineTo(x, TOP_VALUE_BAND_HEIGHT + 9 + 36)
      }

      if (renderMidpointTicks && i < totalSteps) {
        const midX = x + stepPx / 2
        minorPath.moveTo(midX, TOP_VALUE_BAND_HEIGHT + 11)
        minorPath.lineTo(midX, TOP_VALUE_BAND_HEIGHT + 11 + 26)
      }
    }
    return { majorTicksPath: majorPath, minorTicksPath: minorPath, labels: labelList }
  }, [
    totalSteps,
    min,
    step,
    decimals,
    stepPx,
    majorEvery,
    minorEvery,
    renderMinor,
    labelEveryStep,
    renderMidpointTicks,
    labelFont,
  ])

  const prevLabelX =
    prevMarkOffset != null && previousValueLabel != null && prevLabelFont
      ? prevMarkOffset - prevLabelFont.getTextWidth(previousValueLabel) / 2
      : null

  const dial = (
    <View style={styles.rootView}>
      <View style={styles.container} onLayout={(e) => setCanvasWidth(e.nativeEvent.layout.width)}>
        <GestureDetector gesture={panGesture}>
          <Animated.View style={styles.gestureArea}>
            {canvasWidth > 0 && (
              <Canvas style={styles.canvas}>
                <Group transform={stripTransform}>
                  <Path
                    path={minorTicksPath}
                    style="stroke"
                    color={MINOR_TICK_COLOR}
                    strokeWidth={1}
                  />
                  <Path
                    path={majorTicksPath}
                    style="stroke"
                    color={MAJOR_TICK_COLOR}
                    strokeWidth={1}
                  />
                  {labelFont &&
                    labels.map((label) => (
                      <SkiaText
                        key={label.key}
                        x={label.x}
                        y={LABEL_BASELINE_Y}
                        text={label.text}
                        font={labelFont}
                        color={LABEL_COLOR}
                      />
                    ))}
                  {prevMarkOffset != null && (
                    <>
                      <Rect
                        x={prevMarkOffset - 1.5}
                        y={TOP_VALUE_BAND_HEIGHT}
                        width={3}
                        height={RULER_LABEL_BAND_TOP - TOP_VALUE_BAND_HEIGHT}
                        color={theme.palette.slate.surface}
                      />
                      <Line
                        p1={vec(prevMarkOffset, TOP_VALUE_BAND_HEIGHT)}
                        p2={vec(prevMarkOffset, RULER_LABEL_BAND_TOP)}
                        color={PREV_MARK_COLOR}
                        strokeWidth={1}
                      >
                        <DashPathEffect intervals={[3, 3]} />
                      </Line>
                      {previousValueLabel != null && prevLabelX != null && prevLabelFont && (
                        <SkiaText
                          x={prevLabelX}
                          y={LABEL_BASELINE_Y}
                          text={previousValueLabel}
                          font={prevLabelFont}
                          color={PREV_MARK_COLOR}
                        />
                      )}
                    </>
                  )}
                </Group>
                {indicatorGlow && (
                  <Rect
                    x={indicatorGlow === 'left' ? centerX - GLOW_WIDTH : centerX}
                    y={CURRENT_VALUE_TOP}
                    width={GLOW_WIDTH}
                    height={RULER_LABEL_BAND_TOP - CURRENT_VALUE_TOP}
                  >
                    <LinearGradient
                      start={vec(indicatorGlow === 'left' ? centerX - GLOW_WIDTH : centerX, 0)}
                      end={vec(indicatorGlow === 'left' ? centerX : centerX + GLOW_WIDTH, 0)}
                      colors={
                        indicatorGlow === 'left'
                          ? [`${color}00`, `${color}12`, `${color}1A`]
                          : [`${color}1A`, `${color}12`, `${color}00`]
                      }
                    />
                  </Rect>
                )}
              </Canvas>
            )}
          </Animated.View>
        </GestureDetector>
        <View
          style={[styles.indicatorTop, { backgroundColor: color, shadowColor: color }]}
          pointerEvents="none"
        />
        <View style={styles.valueBadgeAnchor} pointerEvents="none">
          <Canvas style={styles.valueBadgeCanvas}>
            {badgeFont && (
              <SkiaText
                x={badgeX}
                y={BADGE_BASELINE}
                text={badgeText}
                font={badgeFont}
                color={color}
              />
            )}
          </Canvas>
          {unit ? <Text style={styles.valueBadgeUnit}>{unit}</Text> : null}
        </View>
      </View>
    </View>
  )

  return nativeScrollGesture ? dial : <GestureHandlerRootView>{dial}</GestureHandlerRootView>
}

const styles = StyleSheet.create({
  rootView: {
    overflow: 'hidden',
    borderRadius: 12,
  },
  container: {
    height: DIAL_HEIGHT,
    overflow: 'hidden',
  },
  gestureArea: {
    flex: 1,
  },
  canvas: {
    width: '100%',
    height: DIAL_HEIGHT,
  },
  indicatorTop: {
    position: 'absolute',
    top: CURRENT_VALUE_TOP,
    left: '50%',
    width: MARKER_LINE_WIDTH,
    height: RULER_LABEL_BAND_TOP - CURRENT_VALUE_TOP,
    marginLeft: -MARKER_LINE_WIDTH / 2,
    borderRadius: 2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
    elevation: 4,
  },
  valueBadgeAnchor: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: CURRENT_VALUE_TOP,
    height: TOP_VALUE_BAND_HEIGHT - CURRENT_VALUE_TOP,
  },
  valueBadgeCanvas: {
    position: 'absolute',
    right: '50%',
    marginRight: 7,
    width: BADGE_WIDTH,
    height: 22,
  },
  valueBadgeUnit: {
    position: 'absolute',
    left: '50%',
    marginLeft: 7,
    bottom: 3,
    color: theme.palette.slate.textMuted,
    fontSize: 9,
    fontWeight: '800',
    lineHeight: 10,
    textAlign: 'left',
  },
})
