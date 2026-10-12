import type { BatteryPresetConfig } from 'vescape-core'

import type { RailId } from '@/modules/board/lib/railPresets'

export type BoardPresetBrand = 'Fungineers' | 'Floatwheel' | 'Lenco Solutions' | 'GoSmilo'
export type RailBrand =
  | 'Future Motion'
  | 'Fungineers'
  | 'The Float Life'
  | 'Floatwheel'
  | 'Floatboxx'
  | 'GoSmilo'

export interface BoardPreset {
  id: string
  name: string
  brand: BoardPresetBrand
  railId: RailId
  batteryConfig: BatteryPresetConfig
}

export interface CustomRailOption {
  id: string
  name: string
  brand: RailBrand
  railId: RailId
}

// Conversion defaults describe the stock battery of the board being converted. Riders can
// replace these values on the battery step when their board has an aftermarket pack.
const STOCK_XR: BatteryPresetConfig = {
  mode: 'preset',
  cellPresetId: 'murata:18650:us18650vtc6',
  seriesCount: 15,
  parallelCount: 2,
}
const STOCK_PINT: BatteryPresetConfig = {
  mode: 'preset',
  cellPresetId: 'murata:18650:us18650vtc5d',
  seriesCount: 15,
  parallelCount: 1,
}
const STOCK_GT: BatteryPresetConfig = {
  mode: 'preset',
  cellPresetId: 'molicel:21700:p42a',
  seriesCount: 18,
  parallelCount: 2,
}
const STOCK_XR_CLASSIC: BatteryPresetConfig = {
  mode: 'preset',
  cellPresetId: 'molicel:18650:p30b',
  seriesCount: 18,
  parallelCount: 2,
}
const STOCK_GT_S: BatteryPresetConfig = {
  mode: 'preset',
  cellPresetId: 'molicel:21700:p45b',
  seriesCount: 27,
  parallelCount: 1,
}
const ADV_20S: BatteryPresetConfig = {
  mode: 'preset',
  cellPresetId: 'lishen:21700:lr2170la',
  seriesCount: 20,
  parallelCount: 2,
}

export const BOARD_PRESETS: readonly BoardPreset[] = [
  // Factory X7 packs: fungineers.us/products/funwheel-x7-supercharged-high-voltage,
  // /funwheel-x7, and /funwheel-x7-long-range.
  {
    id: 'x7-hv',
    name: 'Funwheel X7 Supercharged (High Voltage)',
    brand: 'Fungineers',
    railId: 'x7',
    batteryConfig: {
      mode: 'preset',
      cellPresetId: 'reliance:21700:rs50',
      seriesCount: 32,
      parallelCount: 1,
    },
  },
  {
    id: 'x7-sport',
    name: 'Funwheel X7 Sport',
    brand: 'Fungineers',
    railId: 'x7',
    batteryConfig: {
      mode: 'preset',
      cellPresetId: 'molicel:18650:p30b',
      seriesCount: 20,
      parallelCount: 2,
    },
  },
  {
    id: 'x7-long-range',
    name: 'Funwheel X7 Long Range',
    brand: 'Fungineers',
    railId: 'x7',
    batteryConfig: {
      mode: 'preset',
      cellPresetId: 'samsung:21700:50s',
      seriesCount: 20,
      parallelCount: 2,
    },
  },
  // ADV2 and Atom: floatwheel.co product IDs 9904 and 9935.
  { id: 'adv', name: 'ADV', brand: 'Floatwheel', railId: 'adv', batteryConfig: ADV_20S },
  {
    id: 'adv2',
    name: 'ADV2',
    brand: 'Floatwheel',
    railId: 'adv',
    batteryConfig: {
      mode: 'preset',
      cellPresetId: 'samsung:21700:50s',
      seriesCount: 20,
      parallelCount: 2,
    },
  },
  {
    id: 'adv-pro',
    name: 'ADV Pro',
    brand: 'Floatwheel',
    railId: 'adv-pro',
    batteryConfig: {
      mode: 'preset',
      cellPresetId: 'molicel:21700:p42a',
      seriesCount: 20,
      parallelCount: 2,
    },
  },
  {
    id: 'atom',
    name: 'Atom',
    brand: 'Floatwheel',
    railId: 'pint',
    batteryConfig: {
      mode: 'preset',
      cellPresetId: 'reliance:21700:rs50',
      seriesCount: 22,
      parallelCount: 1,
    },
  },
  {
    id: 'lenco-v7-1',
    name: 'Lenco V7.1 BTG',
    brand: 'Lenco Solutions',
    railId: 'xr',
    batteryConfig: {
      mode: 'preset',
      cellPresetId: 'reliance:21700:rs50',
      seriesCount: 18,
      parallelCount: 2,
    },
  },
  // gosmilo.io/products/gosmilo-x7 and /gosmilo-x9 list Samsung 50S 18S2P packs.
  {
    id: 'gosmilo-x7',
    name: 'GoSmilo X7',
    brand: 'GoSmilo',
    railId: 'gosmilo-x7',
    batteryConfig: {
      mode: 'preset',
      cellPresetId: 'samsung:21700:50s',
      seriesCount: 18,
      parallelCount: 2,
    },
  },
  {
    id: 'gosmilo-x9',
    name: 'GoSmilo X9',
    brand: 'GoSmilo',
    railId: 'gosmilo-x9',
    batteryConfig: {
      mode: 'preset',
      cellPresetId: 'samsung:21700:50s',
      seriesCount: 18,
      parallelCount: 2,
    },
  },
  { id: 'xrv', name: 'XRV (XR)', brand: 'Floatwheel', railId: 'xr', batteryConfig: STOCK_XR },
  {
    id: 'pintv-pint',
    name: 'PintV (Pint)',
    brand: 'Floatwheel',
    railId: 'pint',
    batteryConfig: STOCK_PINT,
  },
  {
    id: 'pintv',
    name: 'PintV (Pint X)',
    brand: 'Floatwheel',
    railId: 'pint',
    batteryConfig: STOCK_XR,
  },
  { id: 'gtv', name: 'GTV (GT)', brand: 'Floatwheel', railId: 'gt', batteryConfig: STOCK_GT },
  {
    id: 'gtv-xrc',
    name: 'GTV (XR Classic)',
    brand: 'Floatwheel',
    railId: 'xr-classic',
    batteryConfig: STOCK_XR_CLASSIC,
  },
  { id: 'gtfo', name: 'GTFO (GT)', brand: 'Fungineers', railId: 'gt', batteryConfig: STOCK_GT },
  {
    id: 'gtsfo',
    name: 'GT-SFO (GT-S)',
    brand: 'Fungineers',
    railId: 'gts-recurve',
    batteryConfig: STOCK_GT_S,
  },
]

export const BOARD_PRESET_BRANDS: readonly BoardPresetBrand[] = [
  'Fungineers',
  'Floatwheel',
  'Lenco Solutions',
  'GoSmilo',
]

export const CUSTOM_RAIL_BRANDS: readonly RailBrand[] = [
  'Future Motion',
  'Fungineers',
  'The Float Life',
  'Floatwheel',
  'Floatboxx',
  'GoSmilo',
]

export const CUSTOM_RAIL_OPTIONS: readonly CustomRailOption[] = [
  { id: 'xr', name: 'XR', brand: 'Future Motion', railId: 'xr' },
  { id: 'xr-classic', name: 'XR Classic', brand: 'Future Motion', railId: 'xr-classic' },
  { id: 'xr-recurve', name: 'XR Classic Recurve', brand: 'Future Motion', railId: 'xr-recurve' },
  { id: 'gt', name: 'GT', brand: 'Future Motion', railId: 'gt' },
  { id: 'gts-recurve', name: 'GTS Recurve', brand: 'Future Motion', railId: 'gts-recurve' },
  { id: 'gts-xl', name: 'GTS XL', brand: 'Future Motion', railId: 'gts-xl' },
  { id: 'pint', name: 'Pint', brand: 'Future Motion', railId: 'pint' },
  { id: 'x7', name: 'X7', brand: 'Fungineers', railId: 'x7' },
  { id: 'x10', name: 'X10', brand: 'Fungineers', railId: 'x10' },
  { id: 'thunder', name: 'Thunder Rails', brand: 'Fungineers', railId: 'thunder' },
  { id: 'xr-wtf', name: 'XR WTF', brand: 'The Float Life', railId: 'xr-wtf' },
  { id: 'xr-wtf-btg', name: 'XR WTF BTG', brand: 'The Float Life', railId: 'xr-wtf-btg' },
  { id: 'gt-wtf', name: 'GT WTF', brand: 'The Float Life', railId: 'gt-wtf' },
  { id: 'gt-wtf-btg', name: 'GT WTF BTG', brand: 'The Float Life', railId: 'gt-wtf-btg' },
  { id: 'gt-dub-tails', name: 'GT Dub Tails', brand: 'The Float Life', railId: 'gt-dub-tails' },
  { id: 'adv', name: 'ADV / ADV2', brand: 'Floatwheel', railId: 'adv' },
  { id: 'adv-pro', name: 'ADV Pro', brand: 'Floatwheel', railId: 'adv-pro' },
  { id: 'atom', name: 'Atom', brand: 'Floatwheel', railId: 'pint' },
  { id: 'razr-v1', name: 'RazrRails V1', brand: 'Floatboxx', railId: 'razr-v1' },
  { id: 'cyber', name: 'CyberRails', brand: 'Floatboxx', railId: 'cyber' },
  { id: 'gosmilo-x9', name: 'X9', brand: 'GoSmilo', railId: 'gosmilo-x9' },
  { id: 'gosmilo-x7', name: 'X7', brand: 'GoSmilo', railId: 'gosmilo-x7' },
]

export function getBoardPreset(id: string | null): BoardPreset | null {
  return BOARD_PRESETS.find((preset) => preset.id === id) ?? null
}

export function getCustomRailOption(id: string | null): CustomRailOption | null {
  return CUSTOM_RAIL_OPTIONS.find((option) => option.id === id) ?? null
}
