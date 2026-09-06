import { create } from 'zustand'

import { createTuneProfileDraftSlice } from '@/modules/tune/store/tuneProfileDraftSlice'
import { createTuneProfileLibrarySlice } from '@/modules/tune/store/tuneProfileLibrarySlice'
import type { TuneProfileStore } from '@/modules/tune/store/tuneProfileStoreTypes'

export const useTuneProfileStore = create<TuneProfileStore>((set, get) => ({
  ...createTuneProfileLibrarySlice(set, get),
  ...createTuneProfileDraftSlice(set, get),
}))
