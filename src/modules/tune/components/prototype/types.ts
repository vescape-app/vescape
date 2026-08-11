// PROTOTYPE — throwaway. Props every tune-screen variant receives.

import type { View } from 'react-native'
import type { RefloatConfigField, RefloatConfigGroup, TuneProfile } from 'vescape-core'

import type { BasicSliderItem } from '@/modules/tune/lib/sliderDefinitions'

export interface TuneVariantProps {
  activeProfile: TuneProfile | null
  basicSliders: BasicSliderItem[]
  displayGroups: RefloatConfigGroup[]
  dirtyFields: Record<string, unknown>
  boardDiffByField: Map<string, { boardValue?: unknown; profileValue?: unknown }>
  setDraftField: (fieldId: string, value: number) => void
  revertField: (fieldId: string) => void
  acceptBoardField: (fieldId: string) => void
  openFieldEditor: (
    field: RefloatConfigField,
    ref: { current: View | null },
    color?: string,
  ) => void
  openBasicSliderEditor: (sliderId: string, ref: { current: View | null }) => void
  resetSliderFormula: (sliderId: string) => void
}
