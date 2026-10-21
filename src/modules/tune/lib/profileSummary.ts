import type { TuneProfileFieldValue } from 'vescape-core'
import { BASIC_SLIDER_BY_ID } from '@/modules/tune/lib/sliderDefinitions'

export interface TuneProfileSummary {
  aggression: number | null
  turning: number | null
  atr: number | null
}

/** Five-segment summaries of the existing Basic sliders, not a simulated ride rating. */
export function tuneProfileSummary(
  fields: Record<string, TuneProfileFieldValue>,
): TuneProfileSummary {
  const numericFields = new Map(
    Object.entries(fields).map(([key, value]) => [
      key,
      typeof value === 'number' && Number.isFinite(value) ? value : null,
    ]),
  )
  const level = (id: string): number | null => {
    const slider = BASIC_SLIDER_BY_ID.get(id)!
    const value = slider.deriveSliderValue(numericFields)
    return value == null ? null : Math.round(((value - slider.min) / (slider.max - slider.min)) * 5)
  }
  return {
    aggression: level('aggressiveness'),
    turning: level('carveTilt'),
    atr: level('atrIntensity'),
  }
}
