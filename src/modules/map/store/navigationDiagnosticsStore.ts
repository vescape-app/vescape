import { create } from 'zustand'
import type { MotionDiagnostics } from '@/modules/map/lib/liveMotion/motion'
import type { LocationEvent } from 'vescape-core'

export interface NavigationDiagnosticsState {
  showRawGps: boolean
  setShowRawGps: (visible: boolean) => void
  showProjectionConnector: boolean
  setShowProjectionConnector: (show: boolean) => void
  motion: MotionDiagnostics | null
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
  showRawGps: true,
  setShowRawGps: (showRawGps) => set({ showRawGps }),
  showProjectionConnector: false,
  setShowProjectionConnector: (showProjectionConnector) => set({ showProjectionConnector }),
  motion: null,
  updatedAt: null,
  update(next) {
    set({ ...next, updatedAt: Date.now() })
  },
}))
