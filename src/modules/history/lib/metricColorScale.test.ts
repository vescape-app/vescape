import { describe, expect, test } from 'bun:test'

import { accentColors } from '@/constants/theme'
import type { TelemetrySample } from '@/modules/history/store/historyStore'

import {
  getHistoryMetricHotRange,
  getMetricRampColor,
  getTelemetrySampleMetricValue,
  makeMetricColorRange,
} from '@/modules/history/lib/metricColorScale'

describe('metricColorScale', () => {
  test('uses configured absolute range for red ramp', () => {
    const range = makeMetricColorRange('#000000', { start: 40, end: 50 })

    expect(getMetricRampColor(39, range)).toBe('#000000')
    expect(getMetricRampColor(40, range)).toBe('#000000')
    expect(getMetricRampColor(50, range)).toBe(accentColors.dark.red.color)
  })

  test('keeps threshold config in one editable place', () => {
    expect(getHistoryMetricHotRange('speed')).toEqual({ start: 30, end: 40 })
    expect(getHistoryMetricHotRange('duty')).toEqual({ start: 60, end: 80 })
    expect(getHistoryMetricHotRange('tempController')).toEqual({ start: 60, end: 80 })
  })

  test('allows custom hot ranges and disabled gradients', () => {
    expect(getHistoryMetricHotRange('speed', { speed: { start: 10, end: 20 } })).toEqual({
      start: 10,
      end: 20,
    })
    expect(getHistoryMetricHotRange('speed', { speed: { start: 10, end: 20 } }, false)).toBeNull()
  })

  test('reads nullable controller temperature from telemetry sample', () => {
    const sample = {
      speedKmh: 12,
      dutyCycle: 0.42,
      batteryVoltage: 50,
      tempMotor: 44,
      tempMosfet: null,
      motorCurrent: 8,
      batteryCurrent: 3,
    } as TelemetrySample

    expect(getTelemetrySampleMetricValue(sample, 'tempController')).toBeNull()
    expect(getTelemetrySampleMetricValue(sample, 'duty')).toBe(42)
  })
})
