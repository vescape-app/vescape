import { describe, expect, test } from 'bun:test'

import {
  batteryLevel,
  dutyLevel,
  DEFAULT_ALERT_SEEDS,
  speedLevel,
  tempLevel,
} from '@/modules/board/constants/telemetryThresholds'

describe('batteryLevel', () => {
  test('normal at or above the warning threshold', () => {
    expect(batteryLevel(0.31)).toBe('normal')
    expect(batteryLevel(0.3)).toBe('normal')
    expect(batteryLevel(1)).toBe('normal')
  })

  test('warning below 30%', () => {
    expect(batteryLevel(0.29)).toBe('warning')
    expect(batteryLevel(0.1)).toBe('warning')
  })

  test('critical below 10%', () => {
    expect(batteryLevel(0.09)).toBe('critical')
    expect(batteryLevel(0)).toBe('critical')
  })

  test('null/undefined reads as normal', () => {
    expect(batteryLevel(null)).toBe('normal')
    expect(batteryLevel(undefined)).toBe('normal')
  })
})

describe('tempLevel', () => {
  test('normal at or below the warning threshold', () => {
    expect(tempLevel(70)).toBe('normal')
    expect(tempLevel(69)).toBe('normal')
    expect(tempLevel(0)).toBe('normal')
  })

  test('warning above 70', () => {
    expect(tempLevel(71)).toBe('warning')
    expect(tempLevel(80)).toBe('warning')
  })

  test('critical above 80', () => {
    expect(tempLevel(81)).toBe('critical')
    expect(tempLevel(90)).toBe('critical')
  })

  test('null/undefined reads as normal', () => {
    expect(tempLevel(null)).toBe('normal')
    expect(tempLevel(undefined)).toBe('normal')
  })
})

describe('speedLevel', () => {
  test('normal at or below the warning threshold', () => {
    expect(speedLevel(35)).toBe('normal')
    expect(speedLevel(34)).toBe('normal')
    expect(speedLevel(0)).toBe('normal')
  })

  test('warning above 35', () => {
    expect(speedLevel(36)).toBe('warning')
    expect(speedLevel(45)).toBe('warning')
  })

  test('critical above 45', () => {
    expect(speedLevel(46)).toBe('critical')
    expect(speedLevel(80)).toBe('critical')
  })

  test('null/undefined reads as normal', () => {
    expect(speedLevel(null)).toBe('normal')
    expect(speedLevel(undefined)).toBe('normal')
  })

  test('uses absolute value', () => {
    expect(speedLevel(-46)).toBe('critical')
  })
})

describe('dutyLevel', () => {
  test('normal at or below the warning threshold', () => {
    expect(dutyLevel(80)).toBe('normal')
    expect(dutyLevel(79)).toBe('normal')
    expect(dutyLevel(0)).toBe('normal')
  })

  test('warning above 80', () => {
    expect(dutyLevel(81)).toBe('warning')
    expect(dutyLevel(90)).toBe('warning')
  })

  test('critical above 90', () => {
    expect(dutyLevel(91)).toBe('critical')
    expect(dutyLevel(100)).toBe('critical')
  })

  test('null/undefined reads as normal', () => {
    expect(dutyLevel(null)).toBe('normal')
    expect(dutyLevel(undefined)).toBe('normal')
  })
})

describe('DEFAULT_ALERT_SEEDS', () => {
  test('battery temp speed duty presets sourced from thresholds', () => {
    expect(DEFAULT_ALERT_SEEDS['motor-temp']).toEqual({ tab: 'message', threshold: 70 })
    expect(DEFAULT_ALERT_SEEDS.battery).toEqual({ tab: 'message', threshold: 30 })
    expect(DEFAULT_ALERT_SEEDS.speed).toEqual({
      tab: 'geiger',
      threshold: 35,
      thresholdMax: 45,
    })
    expect(DEFAULT_ALERT_SEEDS.duty).toEqual({
      tab: 'geiger',
      threshold: 80,
      thresholdMax: 90,
    })
  })
})
