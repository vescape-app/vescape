import { create } from 'zustand'
import {
  addNavigationListener,
  getSettings,
  setDirectionPoint as persistDirectionPoint,
  type Navigation,
} from 'vescape-core'

/**
 * Personal navigation target. Not a Map Point: it is never shared, has no author and no reactions.
 * Native persists it so Group Ride presence can read it while JS is gone.
 */
export interface DirectionPoint {
  latitude: number
  longitude: number
}

interface MapState {
  directionPoint: DirectionPoint | null
  /**
   * Path to the direction point, mirrored from native. Native computes and owns it; this store only
   * carries it to the map layer. `null` while none exists or none could be computed.
   */
  navigation: Navigation | null
  /** Last direction point write failure, in rider-facing words. Cleared by the next success. */
  error: string | null
}

interface MapActions {
  loadDirectionPoint(): Promise<void>
  setDirectionPoint(latitude: number, longitude: number): Promise<void>
  clearDirectionPoint(): Promise<void>
  replaceNavigation(navigation: Navigation | null): void
}

const DIRECTION_POINT_WRITE_FAILED = 'Could not save the direction point.'

export const useMapStore = create<MapState & MapActions>((set, get) => {
  /**
   * The target moves on screen immediately, but native owns it — Group Ride presence reads native,
   * not this store. A failed write puts the previous target back so the two cannot disagree.
   */
  async function moveDirectionPoint(next: DirectionPoint | null) {
    const previous = get().directionPoint
    set({ directionPoint: next, error: null })
    try {
      await persistDirectionPoint(next?.latitude ?? null, next?.longitude ?? null)
    } catch {
      set({ directionPoint: previous, error: DIRECTION_POINT_WRITE_FAILED })
    }
  }

  return {
    directionPoint: null,
    navigation: null,
    error: null,

    async loadDirectionPoint() {
      const settings = await getSettings()
      const { directionPointLatitude, directionPointLongitude } = settings
      set({
        directionPoint:
          directionPointLatitude != null && directionPointLongitude != null
            ? { latitude: directionPointLatitude, longitude: directionPointLongitude }
            : null,
      })
    },

    async setDirectionPoint(latitude, longitude) {
      await moveDirectionPoint({ latitude, longitude })
    },

    async clearDirectionPoint() {
      if (!get().directionPoint) return
      await moveDirectionPoint(null)
    },

    replaceNavigation(navigation) {
      set({ navigation })
    },
  }
})

/**
 * Wire the native → JS Navigation mirror. Call once at app root; returns an unsubscribe.
 *
 * Push only, unlike `startAppStatusSync`: native replays the current Navigation on subscribe and on
 * every change, so there is nothing a separate pull could catch up on.
 */
export function startNavigationSync(): () => void {
  const sub = addNavigationListener((event) =>
    useMapStore.getState().replaceNavigation(event.navigation),
  )
  return () => sub.remove()
}
