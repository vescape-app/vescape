import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cancelAnimation, useSharedValue, withTiming } from 'react-native-reanimated'
import { startAlertTest, stopAlertTest, updateAlertTest, type AlertTestRule } from 'vescape-core'

import { alertZoneSweep } from '@/modules/alerts/lib/alertTest'

const END_HOLD_MS = 1_000
const SAMPLE_INTERVAL_MS = 100

interface AlertTestOptions {
  rules: AlertTestRule[]
  min: number
  max: number
  /** Battery alerts below their threshold, so its sweep starts full and runs down. */
  alertAbove: boolean
}

/** Own the synthetic gauge sweep and its isolated native alert-engine lifecycle. */
export function useAlertTest({ rules, min, max, alertAbove }: AlertTestOptions) {
  const value = useSharedValue<number | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const [running, setRunning] = useState(false)

  const stop = useCallback(() => {
    if (timer.current != null) {
      clearInterval(timer.current)
      timer.current = null
    }
    cancelAnimation(value)
    value.set(null)
    stopAlertTest()
    setRunning(false)
  }, [value])

  const start = useCallback(() => {
    if (rules.length === 0 || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return
    stop()

    const { durationMs, easing } = alertZoneSweep(rules, min, max, alertAbove)
    const startValue = alertAbove ? min : max
    const endValue = alertAbove ? max : min
    const startedAt = Date.now()

    value.set(startValue)
    value.set(withTiming(endValue, { duration: durationMs, easing }))
    startAlertTest(rules)
    updateAlertTest(startValue)
    setRunning(true)

    // Native hears the same curve the needle draws, so sounds land as the needle crosses.
    timer.current = setInterval(() => {
      const elapsed = Date.now() - startedAt
      if (elapsed >= durationMs + END_HOLD_MS) {
        stop()
        return
      }
      const eased = easing(Math.min(elapsed / durationMs, 1))
      updateAlertTest(startValue + (endValue - startValue) * eased)
    }, SAMPLE_INTERVAL_MS)
  }, [alertAbove, max, min, rules, stop, value])

  // A route can blur without unmounting. Blur cleanup guarantees no test survives leaving a page.
  useFocusEffect(useCallback(() => stop, [stop]))
  // A level/rule/range change invalidates the snapshot currently being tested.
  useEffect(() => stop, [max, min, rules, stop])

  return {
    value,
    running,
    canRun: rules.length > 0,
    start,
    stop,
  }
}
