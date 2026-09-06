/* eslint-disable react-hooks/immutability, react-hooks/refs */
import * as Haptics from 'expo-haptics'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Platform } from 'react-native'
import { Gesture } from 'react-native-gesture-handler'
import {
  cancelAnimation,
  useFrameCallback,
  useSharedValue,
  withSpring,
  type FrameCallback,
} from 'react-native-reanimated'
import type { GestureType } from 'react-native-gesture-handler'
import { scheduleOnRN } from 'react-native-worklets'

import {
  DRAG_RANGE_GAIN,
  THROW_STOP_VELOCITY,
  advanceTuneDialThrow,
  computeHapticStepSpacing,
  isTuneDialEdgeStep,
  resolveTuneDialThrowTargetOffset,
  resolveTuneDialThrowVelocity,
  shouldApplyExternalTuneDialValue,
  shouldPlayTuneDialHaptic,
} from '@/modules/tune/components/tuneDialPhysics'
import { SNAP_SPRING } from '@/modules/tune/components/tuneDialLayout'

export interface TuneDialGestureOptions {
  value: number
  min: number
  max: number
  step: number
  decimals: number
  commitEveryChange: boolean
  totalSteps: number
  totalWidth: number
  stepPx: number
  valueToOffset: (value: number) => number
  nativeScrollGesture: GestureType | null
  onValueChange: (value: number) => void
}

/**
 * The dial's motion: dragging the strip, throwing it, snapping to a step, and reporting the value
 * — including the haptic ticks that make each step and each end stop felt.
 */
export function useTuneDialGesture({
  value,
  min,
  max,
  step,
  decimals,
  commitEveryChange,
  totalSteps,
  totalWidth,
  stepPx,
  valueToOffset,
  nativeScrollGesture,
  onValueChange,
}: TuneDialGestureOptions) {
  const hapticStepSpacing = computeHapticStepSpacing()
  const initialStepIndex = Math.round((value - min) / step)

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

  return { translateX, displayValue, panGesture }
}
