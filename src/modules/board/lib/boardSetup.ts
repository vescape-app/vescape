import type { BatteryConfig } from 'vescape-core'

import type { deriveBatteryConfig } from '@/modules/battery/lib'
import { BATTERY_CELL_PRESETS } from '@/modules/battery/lib'
import { fmtVoltageRange } from '@/helpers/format'

export type BatteryMode = BatteryConfig['mode']

export type BatterySummary = ReturnType<typeof getBatterySummary>

export function parseVoltage(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const parsed = Number.parseFloat(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

export function buildBatteryConfig(
  mode: BatteryMode,
  cellPresetId: string,
  seriesCount: number,
  parallelCount: number,
  manualMinVoltage: string,
  manualMaxVoltage: string,
): BatteryConfig | null {
  if (mode === 'preset') {
    return {
      mode: 'preset',
      cellPresetId,
      seriesCount,
      parallelCount,
    }
  }
  const minVoltage = parseVoltage(manualMinVoltage)
  const maxVoltage = parseVoltage(manualMaxVoltage)
  if (minVoltage == null || maxVoltage == null || maxVoltage <= minVoltage) return null
  return { mode: 'manual', minVoltage, maxVoltage }
}

export function getBatterySummary(
  keepMissingBatteryConfig: boolean,
  derivedBattery: ReturnType<typeof deriveBatteryConfig>,
  batteryMode: BatteryMode,
  cellPresetId: string,
  seriesCount: number,
  parallelCount: number,
) {
  if (keepMissingBatteryConfig) {
    return {
      title: 'Battery',
      value: 'Tap to add battery config',
      hint: 'Used for voltage and SoC display',
    }
  }
  if (derivedBattery.warning) {
    return {
      title: 'Incomplete config',
      value: derivedBattery.warning,
      hint: 'Tap to fix battery config',
    }
  }
  const voltage = fmtVoltageRange(derivedBattery.minVoltage, derivedBattery.maxVoltage)
  const nominalWh =
    derivedBattery.nominalWh != null ? `${Math.round(derivedBattery.nominalWh)} Wh nominal` : null
  if (batteryMode === 'manual') {
    return {
      title: 'Manual voltage range',
      value: voltage,
      hint: nominalWh ?? 'Manual pack voltage',
    }
  }
  const preset = BATTERY_CELL_PRESETS.find((candidate) => candidate.id === cellPresetId)
  return {
    title: preset ? `${preset.brand} ${preset.model}` : 'Cell preset',
    value: `${seriesCount}s${parallelCount}p, ${voltage}`,
    hint: nominalWh ?? 'Preset pack config',
  }
}
