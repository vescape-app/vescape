import { create } from 'zustand'
import {
  addNavigationListener,
  addRouteProgressListener,
  getSettings,
  recomputeNavigation,
  setDirectionPoint as persistDirectionPoint,
  setNavigationProfile as persistNavigationProfile,
  type Navigation,
  type NavigationProfile,
  type RouteProgress,
} from 'vescape-core'

export interface DirectionPoint {
  latitude: number
  longitude: number
}

interface MapState {
  directionPoint: DirectionPoint | null
  navigation: Navigation | null
  acceptedNavigationRevision: number | null
  navigationComputing: boolean
  routeProgress: RouteProgress | null
  error: string | null
}

interface MapActions {
  loadDirectionPoint(): Promise<void>
  setDirectionPoint(latitude: number, longitude: number): Promise<void>
  clearDirectionPoint(): Promise<void>
  replaceNavigation(navigation: Navigation | null, computing: boolean): void
  replaceRouteProgress(progress: RouteProgress | null): void
  recomputeNavigation(): Promise<void>
  setNavigationProfile(profile: NavigationProfile): Promise<void>
  acceptNavigation(): void
  editNavigation(): void
}

const DIRECTION_POINT_WRITE_FAILED = 'Could not save the direction point.'

function acceptedRevisionAfter(state: MapState, navigation: Navigation | null): number | null {
  const accepted = state.acceptedNavigationRevision
  if (accepted == null || navigation == null) return null
  if (navigation.revision === accepted) return accepted
  return navigation.automatic &&
    navigation.status === 'ready' &&
    state.navigation?.revision === accepted
    ? navigation.revision
    : null
}

export const useMapStore = create<MapState & MapActions>((set, get) => {
  async function moveDirectionPoint(next: DirectionPoint | null) {
    const previous = get().directionPoint
    set({ directionPoint: next, acceptedNavigationRevision: null, error: null })
    try {
      await persistDirectionPoint(next?.latitude ?? null, next?.longitude ?? null)
    } catch {
      set({ directionPoint: previous, error: DIRECTION_POINT_WRITE_FAILED })
    }
  }

  return {
    directionPoint: null,
    navigation: null,
    acceptedNavigationRevision: null,
    navigationComputing: false,
    routeProgress: null,
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
      set((state) => ({
        navigation,
        navigationComputing: computing,
        routeProgress:
          state.routeProgress?.navigationRevision === navigation?.revision
            ? state.routeProgress
            : null,
        acceptedNavigationRevision: acceptedRevisionAfter(state, navigation),
      }))
    },

    replaceRouteProgress(progress) {
      set({ routeProgress: progress })
    },

    async recomputeNavigation() {
      await recomputeNavigation()
    },

    async setNavigationProfile(profile) {
      await persistNavigationProfile(profile)
    },

    acceptNavigation() {
      set({ acceptedNavigationRevision: get().navigation?.revision ?? null })
    },

    editNavigation() {
      set({ acceptedNavigationRevision: null })
    },
  }
})

export function startNavigationSync(): () => void {
  const sub = addNavigationListener((event) =>
    useMapStore.getState().replaceNavigation(event.navigation, event.computing),
  )
  const progressSub = addRouteProgressListener((event) =>
    useMapStore.getState().replaceRouteProgress(event.progress),
  )
  return () => {
    sub.remove()
    progressSub.remove()
  }
}
