import { personalizationColorOptions } from '@/constants/theme'

export type RailColorId = (typeof personalizationColorOptions)[number]['id']

/** Rail color for Boards with no (or an unknown) color picked. */
export const DEFAULT_RAIL_COLOR_ID: RailColorId = 'cyan'

/** The picked rail color option, or the default one. Every board render shares this fallback. */
export function railColorOption(value?: string) {
  return (
    personalizationColorOptions.find((color) => color.id === value) ??
    personalizationColorOptions.find((color) => color.id === DEFAULT_RAIL_COLOR_ID)!
  )
}
