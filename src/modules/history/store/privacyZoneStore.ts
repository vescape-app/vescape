import { create } from 'zustand'
import {
  deletePrivacyZone,
  getPrivacyZones,
  setPrivacyZoneEnabled,
  upsertPrivacyZone,
  type PrivacyZone,
  type PrivacyZonePreset,
} from 'vescape-core'

export type { PrivacyZone } from 'vescape-core'

interface PrivacyZoneState {
  zones: PrivacyZone[]
  loaded: boolean
}

interface PrivacyZoneActions {
  load(): Promise<void>
  save(
    id: string,
    preset: PrivacyZonePreset,
    name: string,
    centerLatitude: number,
    centerLongitude: number,
    radiusMeters: number,
  ): Promise<void>
  update(
    id: string,
    centerLatitude: number,
    centerLongitude: number,
    radiusMeters: number,
  ): Promise<void>
  rename(id: string, newName: string): Promise<void>
  toggle(id: string): Promise<void>
  remove(id: string): Promise<void>
}

export const usePrivacyZoneStore = create<PrivacyZoneState & PrivacyZoneActions>((set, get) => ({
  zones: [],
  loaded: false,

  async load() {
    const zones = await getPrivacyZones()
    set({ zones, loaded: true })
  },

  async save(id, preset, name, centerLatitude, centerLongitude, radiusMeters) {
    const now = Date.now()
    const existing = get().zones.find((z) => z.id === id)
    const zone: PrivacyZone = {
      id: existing?.id ?? id,
      preset,
      name,
      enabled: true,
      centerLatitude,
      centerLongitude,
      radiusMeters,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    set((s) => {
      const exists = s.zones.some((z) => z.id === id)
      return {
        zones: exists ? s.zones.map((z) => (z.id === id ? zone : z)) : [...s.zones, zone],
      }
    })
    await upsertPrivacyZone(zone)
  },

  async update(id, centerLatitude, centerLongitude, radiusMeters) {
    const existing = get().zones.find((z) => z.id === id)
    if (!existing) return
    const zone: PrivacyZone = {
      ...existing,
      centerLatitude,
      centerLongitude,
      radiusMeters,
      updatedAt: Date.now(),
    }
    set((s) => ({ zones: s.zones.map((z) => (z.id === id ? zone : z)) }))
    await upsertPrivacyZone(zone)
  },

  async rename(id, newName) {
    const zone = get().zones.find((z) => z.id === id)
    if (!zone) return
    const updated = { ...zone, name: newName, updatedAt: Date.now() }
    set((s) => ({ zones: s.zones.map((z) => (z.id === id ? updated : z)) }))
    await upsertPrivacyZone(updated)
  },

  async toggle(id) {
    const zone = get().zones.find((z) => z.id === id)
    if (!zone) return
    const enabled = !zone.enabled
    set((s) => ({ zones: s.zones.map((z) => (z.id === id ? { ...z, enabled } : z)) }))
    await setPrivacyZoneEnabled(id, enabled)
  },

  async remove(id) {
    set((s) => ({ zones: s.zones.filter((z) => z.id !== id) }))
    await deletePrivacyZone(id)
  },
}))

export { generateId as generateZoneId } from '@/helpers/id'
