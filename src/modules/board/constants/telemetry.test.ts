import { expect, test } from 'bun:test'

import { telemetry, telemetryByControlId } from '@/modules/board/constants/telemetry'

test('formatWithUnit omits spacing for unitless metrics', () => {
  expect(telemetry.footpadAdc1.formatWithUnit(1.23456)).toBe('1.235')
})

test('speed formatting uses absolute rounded values', () => {
  expect(telemetry.speed.formatWithUnit(-12.4)).toBe('12 km/h')
})

test('battery voltage formatting uses compact unit and single decimal', () => {
  expect(telemetry.battVoltage.formatWithUnit(81.94)).toBe('81.9V')
})

test('control id lookup resolves alert-enabled metrics', () => {
  expect(telemetryByControlId['motor-current']).toBe(telemetry.motorCurrent)
  expect(telemetryByControlId.battery).toBe(telemetry.battVoltage)
})

test('current metrics cover the full alert threshold range', () => {
  expect(telemetry.motorCurrent.chartRange).toEqual({ min: -300, max: 300 })
  expect(telemetry.battCurrent.chartRange).toEqual({ min: -300, max: 300 })
})
