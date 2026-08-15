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
// Map Points are read around the map camera, so the nearby geometry lives with the map.
import { distanceMeters, nearbyRadiusMeters } from '@/modules/map/lib/nearbyRadius'

export type { MapPoint } from 'vescape-core'

interface NearbyRead {
  latitude: number
  longitude: number
  radiusMeters: number
}

/** Skip a refetch while the camera stays inside this much of the last read's radius. */
const REFETCH_MOVE_FRACTION = 0.4

interface MapPointState {
  /** Server truth for the last nearby read. The app keeps no durable copy. */
  mapPoints: MapPoint[]
  /** More Map Points matched than the server returned; the map is showing the nearest slice. */
  truncated: boolean
  loading: boolean
  /** Last read or write failure, in rider-facing words. Cleared by the next success. */
  error: string | null
  selectedMapPointId: string | null
  hiddenMapPointCategories: MapPointCategory[]
  lastRead: NearbyRead | null
}

interface MapPointActions {
  /** Read Map Points around a camera position. Cheap to call on every map idle. */
  refreshNearby(latitude: number, longitude: number, zoom: number): Promise<void>
  /** Re-run the last nearby read, e.g. after sign-in or a foreground catch-up. */
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

/**
 * Whether a fresh read says anything new.
 *
 * `distanceMeters` is deliberately not compared: it is measured from the query centre, so it moves
 * a little on every read while the points themselves have not changed. Keeping the previous array
 * in that case is what stops a still camera from re-rendering the whole map tree once a second.
 */
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
  /**
   * Newest camera position asked for while a read is in flight. Kept to one: older positions are
   * worthless once the rider has moved past them.
   */
  let queuedRead: NearbyRead | null = null

  /**
   * One read path. Reads never overlap — a stale answer landing after a newer one would rewrite the
   * visible set backwards — but the newest target is remembered and run once the current read
   * settles. Dropping it outright would strand the map on the old area, because the camera only
   * idles again when the rider moves it again.
   */
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
      const read = [...nearby.items].sort(byDistance)
      set((s) => {
        const mapPoints = sameMapPoints(s.mapPoints, read) ? s.mapPoints : read
        return {
          mapPoints,
          truncated: nearby.truncated,
          selectedMapPointId: pruneSelectedMapPointId(s.selectedMapPointId, mapPoints),
          loading: false,
          error: null,
        }
      })
    } catch (error) {
      // Nothing is cached offline (Map Points are server-owned), so the map goes empty and says so.
      // `lastRead` is dropped so a still camera retries on its next idle instead of staying empty
      // until the rider pans far enough to beat the skip heuristic.
      set({
        mapPoints: [],
        truncated: false,
        loading: false,
        lastRead: null,
        error: mapPointErrorMessage(error),
      })
    }

    const next = queuedRead
    queuedRead = null
    if (next) await read(next)
  }

  /**
   * One write path: run it, put the answered point into the visible set, surface any failure. The
   * server answer replaces a point already on the map and is appended when it is new.
   */
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
        // Same area, near enough to the last centre: nothing new to reveal.
        if (
          previous.radiusMeters === radiusMeters &&
          moved < radiusMeters * REFETCH_MOVE_FRACTION
        ) {
          return
        }
        // Zoomed in: the new circle sits inside the one already read, so its points are on screen
        // already. A truncated answer is the exception — there, zooming in reveals more.
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

      // Optimistic: a vote must feel instant. The server answer is not echoed back, so the score is
      // adjusted locally and reconciled by the next nearby read.
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
        // Only roll back if this is still the reaction on screen. A newer vote may have landed
        // while this one was in flight, and restoring `previous` would undo it.
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
