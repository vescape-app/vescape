import { create } from 'zustand'
import {
  createMapPoint,
  deleteMapPoint,
  getNearbyMapPoints,
  setMapPointReaction as persistMapPointReaction,
  updateMapPoint,
  type MapPoint,
  type MapPointCategory,
  type MapPointPatch,
  type MapPointReaction,
} from 'vescape-core'

import { mapPointErrorMessage } from '@/modules/map-points/lib/mapPointErrors'
import { distanceMeters, nearbyRadiusMeters } from '@/modules/map/lib/nearbyRadius'

export type { MapPoint } from 'vescape-core'

interface NearbyRead {
  latitude: number
  longitude: number
  radiusMeters: number
}

const REFETCH_MOVE_FRACTION = 0.4

interface MapPointState {
  mapPoints: MapPoint[]
  truncated: boolean
  loading: boolean
  error: string | null
  selectedMapPointId: string | null
  hiddenMapPointCategories: MapPointCategory[]
  lastRead: NearbyRead | null
}

interface MapPointActions {
  refreshNearby(latitude: number, longitude: number, zoom: number): Promise<void>
  reload(): Promise<void>
  addMapPoint(
    category: MapPointCategory,
    latitude: number,
    longitude: number,
  ): Promise<MapPoint | null>
  editMapPoint(id: string, patch: MapPointPatch): Promise<MapPoint | null>
  setMapPointReaction(id: string, reaction: MapPointReaction | null): Promise<MapPoint | null>
  removeMapPoint(id: string): Promise<boolean>
  selectMapPoint(id: string): void
  toggleMapPointSelection(id: string): void
  clearSelectedMapPoints(): void
  toggleMapPointCategoryVisibility(category: MapPointCategory): void
}

const byDistance = (a: MapPoint, b: MapPoint) =>
  a.distanceMeters - b.distanceMeters || a.id.localeCompare(b.id)

function sameMapPoints(previous: MapPoint[], next: MapPoint[]): boolean {
  if (previous.length !== next.length) return false
  return previous.every((point, index) => {
    const candidate = next[index]
    return (
      point.id === candidate.id &&
      point.updatedAt === candidate.updatedAt &&
      point.score === candidate.score &&
      point.myReaction === candidate.myReaction
    )
  })
}

function pruneSelectedMapPointId(selectedId: string | null, mapPoints: MapPoint[]) {
  if (!selectedId) return null
  return mapPoints.some((point) => point.id === selectedId) ? selectedId : null
}

function reactionScore(reaction: MapPointReaction | null) {
  return reaction === 'up' ? 1 : reaction === 'down' ? -1 : 0
}

export const useMapPointStore = create<MapPointState & MapPointActions>((set, get) => {
  let queuedRead: NearbyRead | null = null

  async function read(target: NearbyRead) {
    if (get().loading) {
      queuedRead = target
      return
    }
    set({ loading: true, lastRead: target })
    try {
      const nearby = await getNearbyMapPoints(
        target.latitude,
        target.longitude,
        target.radiusMeters,
      )
      const sorted = [...nearby.items].sort(byDistance)
      set((s) => {
        const mapPoints = sameMapPoints(s.mapPoints, sorted) ? s.mapPoints : sorted
        return {
          mapPoints,
          truncated: nearby.truncated,
          selectedMapPointId: pruneSelectedMapPointId(s.selectedMapPointId, mapPoints),
          loading: false,
          error: null,
        }
      })
    } catch (error) {
      set((s) => ({
        mapPoints: s.mapPoints.length === 0 ? s.mapPoints : [],
        truncated: false,
        loading: false,
        lastRead: null,
        error: mapPointErrorMessage(error),
      }))
    }

    const next = queuedRead
    queuedRead = null
    if (next) await read(next)
  }

  async function write(run: () => Promise<MapPoint>): Promise<MapPoint | null> {
    try {
      const point = await run()
      set((s) => ({
        mapPoints: (s.mapPoints.some((candidate) => candidate.id === point.id)
          ? s.mapPoints.map((candidate) => (candidate.id === point.id ? point : candidate))
          : [...s.mapPoints, point]
        ).sort(byDistance),
        error: null,
      }))
      return point
    } catch (error) {
      set({ error: mapPointErrorMessage(error) })
      return null
    }
  }

  return {
    mapPoints: [],
    truncated: false,
    loading: false,
    error: null,
    selectedMapPointId: null,
    hiddenMapPointCategories: [],
    lastRead: null,

    async refreshNearby(latitude, longitude, zoom) {
      const radiusMeters = nearbyRadiusMeters(zoom, latitude)
      const previous = get().lastRead
      if (previous !== null && !get().truncated) {
        const moved = distanceMeters(previous, { latitude, longitude })
        if (
          previous.radiusMeters === radiusMeters &&
          moved < radiusMeters * REFETCH_MOVE_FRACTION
        ) {
          return
        }
        if (moved + radiusMeters <= previous.radiusMeters) return
      }
      await read({ latitude, longitude, radiusMeters })
    },

    async reload() {
      const last = get().lastRead
      if (!last) return
      await read(last)
    },

    async addMapPoint(category, latitude, longitude) {
      return write(() => createMapPoint({ category, latitude, longitude }))
    },

    async editMapPoint(id, patch) {
      return write(() => updateMapPoint(id, patch))
    },

    async setMapPointReaction(id, reaction) {
      const previous = get().mapPoints.find((point) => point.id === id)
      if (!previous) return null
      if (previous.myReaction === reaction) return previous

      const optimistic: MapPoint = {
        ...previous,
        myReaction: reaction,
        score: previous.score - reactionScore(previous.myReaction) + reactionScore(reaction),
      }
      set((s) => ({
        mapPoints: s.mapPoints.map((point) => (point.id === id ? optimistic : point)),
      }))

      try {
        await persistMapPointReaction(id, reaction)
        set({ error: null })
        return optimistic
      } catch (error) {
        set((s) => ({
          mapPoints: s.mapPoints.map((point) =>
            point.id === id && point.myReaction === optimistic.myReaction ? previous : point,
          ),
          error: mapPointErrorMessage(error),
        }))
        return null
      }
    },

    async removeMapPoint(id) {
      try {
        await deleteMapPoint(id)
        set((s) => ({
          mapPoints: s.mapPoints.filter((point) => point.id !== id),
          selectedMapPointId: s.selectedMapPointId === id ? null : s.selectedMapPointId,
          error: null,
        }))
        return true
      } catch (error) {
        set({ error: mapPointErrorMessage(error) })
        return false
      }
    },

    selectMapPoint(id) {
      set((s) => (s.mapPoints.some((point) => point.id === id) ? { selectedMapPointId: id } : s))
    },

    toggleMapPointSelection(id) {
      set((s) => {
        if (!s.mapPoints.some((point) => point.id === id)) return s
        return { selectedMapPointId: s.selectedMapPointId === id ? null : id }
      })
    },

    clearSelectedMapPoints() {
      set((s) => (s.selectedMapPointId == null ? s : { selectedMapPointId: null }))
    },

    toggleMapPointCategoryVisibility(category) {
      set((s) => ({
        hiddenMapPointCategories: s.hiddenMapPointCategories.includes(category)
          ? s.hiddenMapPointCategories.filter((candidate) => candidate !== category)
          : [...s.hiddenMapPointCategories, category],
      }))
    },
  }
})
