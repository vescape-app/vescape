import type { BatteryConfig } from 'vescape-core'

export interface BatteryCellPreset {
  id: string
  curveId: string
  formFactor: string
  brand: string
  model: string
  chemistry: string
  nominalVoltage: number
  fullVoltage: number
  datasheetEmptyVoltage: number
  recommendedEmptyVoltage: number
  capacityAh: number
  internalResistanceMilliOhm: number
  maxContinuousDischargeA?: number
  verified: boolean
}

export interface DerivedBatteryConfig {
  mode: BatteryConfig['mode']
  minVoltage: number
  maxVoltage: number
  nominalVoltage: number | null
  nominalWh: number | null
  preset: BatteryCellPreset | null
  warning: 'missing' | 'unknown-preset' | 'invalid' | null
}
