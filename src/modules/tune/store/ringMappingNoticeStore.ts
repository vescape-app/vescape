import { create } from 'zustand'

/** Transient presentation only: one explanation per app session, shared by kept-alive editors. */
export const useRingMappingNoticeStore = create<{
  owner: string | null
  acknowledged: boolean
  claim: (owner: string) => void
  release: (owner: string) => void
  dismiss: (owner: string) => void
}>((set) => ({
  owner: null,
  acknowledged: false,
  claim: (owner) =>
    set((state) => (state.acknowledged || state.owner !== null ? state : { owner })),
  release: (owner) => set((state) => (state.owner === owner ? { owner: null } : state)),
  dismiss: (owner) =>
    set((state) => (state.owner === owner ? { owner: null, acknowledged: true } : state)),
}))
