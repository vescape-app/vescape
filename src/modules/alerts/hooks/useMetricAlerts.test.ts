import { describe, expect, mock, test } from 'bun:test'
import * as actualReact from 'react'
import type { BatteryConfig } from 'vescape-core'

// Run the hook as a plain function: no renderer, memo callbacks evaluate immediately.
mock.module('react', () => ({
  ...actualReact,
  use: () => 'km',
  useMemo: <T>(factory: () => T) => factory(),
}))

const { useDraftMetricAlerts, validBatteryConfig } = await import('./useMetricAlerts')
const { getAlertDialConfig } = await import('@/modules/alerts/lib/alertFormDefaults')
const { useBoardStore } = await import('@/modules/board/store/boardStore')

const manual = (minVoltage: number, maxVoltage: number): BatteryConfig =>
  ({ mode: 'manual', minVoltage, maxVoltage }) as unknown as BatteryConfig

function useDraftController(batteryConfig: ReturnType<typeof validBatteryConfig>) {
  return useDraftMetricAlerts('battery', {
    setup: { level: 'off', rules: [] },
    topSpeedKmh: 40,
    hasBatteryConfig: batteryConfig != null,
    batteryConfig,
    onChange: () => {},
  })
}

// #517: wizard battery alerts must follow the draft battery, never the active saved Board's.
describe('draft battery alerts', () => {
  test('first board: valid draft battery edits thresholds in %', () => {
    useBoardStore.setState({ boards: [], activeBoardId: null })
    const draft = validBatteryConfig(manual(60, 84))
    expect(draft).not.toBeNull()

    const controller = useDraftController(draft)

    expect(controller.batteryConfig).toBe(draft)
    expect(getAlertDialConfig('battery', controller.batteryConfig).unit).toBe('%')
  })

  test('invalid draft falls back to volts even when the active Board has a valid battery', () => {
    useBoardStore.setState({
      boards: [{ id: 'active', name: 'Active', batteryConfig: manual(60, 84) } as never],
      activeBoardId: 'active',
    })
    const draft = validBatteryConfig(manual(84, 60))
    expect(draft).toBeNull()

    const controller = useDraftController(draft)

    expect(controller.batteryConfig).toBeNull()
    expect(controller.hasBatteryConfig).toBe(false)
    expect(getAlertDialConfig('battery', controller.batteryConfig).unit).toBe('V')
  })
})
