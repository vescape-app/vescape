import { create } from 'zustand'
import {
  addNavigationListener,
  getSettings,
  recomputeNavigation,
  setDirectionPoint as persistDirectionPoint,
  setNavigationProfile as persistNavigationProfile,
  type Navigation,
  type NavigationProfile,
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
   * carries it to the map layer. `null` while no Direction Point is set; a Navigation whose `status`
   * is not `ready` is a computed answer of "no path", not an absence.
   */
  navigation: Navigation | null
  /**
   * Whether native is computing a path right now, mirrored like the path itself. Nothing on this
   * side sets it from a tap: a rider's request is only "in flight" once native says so, which is
   * also the only thing that can say when it stopped.
   */
  navigationComputing: boolean
  /** Last direction point write failure, in rider-facing words. Cleared by the next success. */
  error: string | null
}

interface MapActions {
  loadDirectionPoint(): Promise<void>
  setDirectionPoint(latitude: number, longitude: number): Promise<void>
  clearDirectionPoint(): Promise<void>
  replaceNavigation(navigation: Navigation | null, computing: boolean): void
  recomputeNavigation(): Promise<void>
  setNavigationProfile(profile: NavigationProfile): Promise<void>
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
    navigationComputing: false,
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

    replaceNavigation(navigation, computing) {
      set({ navigation, navigationComputing: computing })
    },

    /**
     * The rider asking for the path again. Nothing is set here: native recomputes and pushes the
     * result back through `onNavigation` like any other change, so this side never holds a second
     * opinion about the path. Only ever called from a rider tap.
     */
    async recomputeNavigation() {
      await recomputeNavigation()
    },

    /**
     * The rider switching which kind of ways the path may follow. Native owns both halves — storing
     * the choice and computing the new path — so this side neither remembers the profile nor waits
     * for the result; the new Navigation arrives through `onNavigation` like any other.
     */
    async setNavigationProfile(profile) {
      await persistNavigationProfile(profile)
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
    useMapStore.getState().replaceNavigation(event.navigation, event.computing),
  )
  return () => sub.remove()
}
