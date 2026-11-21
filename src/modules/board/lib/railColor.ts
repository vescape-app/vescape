import { personalizationColorOptions } from '@/constants/theme'

export type RailColorId = (typeof personalizationColorOptions)[number]['id']

export const DEFAULT_RAIL_COLOR_ID = 'purple' satisfies RailColorId

export function railColorOption(value?: string) {
  return (
    personalizationColorOptions.find((color) => color.id === value) ??
    personalizationColorOptions.find((color) => color.id === DEFAULT_RAIL_COLOR_ID)!
  )
}
