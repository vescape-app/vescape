import { create } from 'zustand'
import type { LocationEvent } from 'vescape-core'

export interface NavigationDiagnosticsState {
  /** Session-only map debug overlay; never changes GPS acquisition or recording. */
  showDisplayTrail: boolean
  setShowDisplayTrail: (visible: boolean) => void
  showRawGps: boolean
  setShowRawGps: (visible: boolean) => void
  showProjectionConnector: boolean
  setShowProjectionConnector: (show: boolean) => void
  gpsFix: LocationEvent | null
  retainedGpsBearingDeg: number | null
  retainedGpsBearingAt: number | null
  phoneHeadingDeg: number | null
  phoneHeadingStatus: string
  activeDisplayHeadingDeg: number | null
  cameraHeadingDeg: number | null
  fallbackReason: string | null
  updatedAt: number | null
  update: (next: NavigationDiagnosticsSnapshot) => void
}

type NavigationDiagnosticsSnapshot = Pick<
  NavigationDiagnosticsState,
  | 'gpsFix'
  | 'retainedGpsBearingDeg'
  | 'retainedGpsBearingAt'
  | 'phoneHeadingDeg'
  | 'phoneHeadingStatus'
  | 'activeDisplayHeadingDeg'
  | 'cameraHeadingDeg'
  | 'fallbackReason'
>

const INITIAL_SNAPSHOT: NavigationDiagnosticsSnapshot = {
  gpsFix: null,
  retainedGpsBearingDeg: null,
  retainedGpsBearingAt: null,
  phoneHeadingDeg: null,
  phoneHeadingStatus: 'idle',
  activeDisplayHeadingDeg: null,
  cameraHeadingDeg: null,
  fallbackReason: 'map_not_ready',
}

export const useNavigationDiagnosticsStore = create<NavigationDiagnosticsState>((set) => ({
  ...INITIAL_SNAPSHOT,
  showDisplayTrail: true,
  setShowDisplayTrail: (showDisplayTrail) => set({ showDisplayTrail }),
  showRawGps: true,
  setShowRawGps: (showRawGps) => set({ showRawGps }),
  showProjectionConnector: false,
  setShowProjectionConnector(show) {
    set({ showProjectionConnector: show })
  },
  updatedAt: null,
  update(next) {
    set({ ...next, updatedAt: Date.now() })
  },
}))
