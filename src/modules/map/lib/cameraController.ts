import type { MapNavigationMode } from '@/modules/map/constants/mapStyles'

import {
  getMapCameraProfileForNavigationMode,
  getPaddingForProfile,
  getPitchForProfileZoom,
  getProfileZoomLevel,
  MAP_CAMERA_PROFILES,
  type CameraPadding,
  type MapCameraProfileKey,
} from '@/modules/map/lib/cameraProfiles'

export interface MapCameraSnapshot {
  centerCoordinate: [number, number]
  zoomLevel: number
  heading: number
  pitch: number
  padding?: CameraPadding
}

export type MapCameraMode =
  | { kind: 'liveFollow' }
  | { kind: 'manualBrowse' }
  | {
      kind: 'rideHistory'
      selectionKey: string | null
      phase: 'preview' | 'route' | 'manualInspect'
    }

/** True when both modes are the same logical camera mode (value equality). */
export function mapCameraModesEqual(a: MapCameraMode, b: MapCameraMode): boolean {
  if (a === b) return true
  if (a.kind !== b.kind) return false
  if (a.kind !== 'rideHistory' || b.kind !== 'rideHistory') return true
  return a.selectionKey === b.selectionKey && a.phase === b.phase
}

export interface MapCameraControllerState {
  mode: MapCameraMode
  followZoomLevel: number | null
}

export type MapCameraIntent =
  | {
      type: 'FollowLive'
      gpsCamera: Pick<MapCameraSnapshot, 'centerCoordinate' | 'zoomLevel'>
      followHeadingDeg: number
      navigationMode: MapNavigationMode
      perspectiveEnabled: boolean
      viewportHeight?: number
      preserveHeading?: number
      enforceMinimums?: boolean
    }
  | { type: 'BrowseManually'; historySelectionKey?: string | null }
  | {
      type: 'SetFollowZoom'
      zoomLevel: number
      gpsCamera: Pick<MapCameraSnapshot, 'centerCoordinate' | 'zoomLevel'>
      followHeadingDeg: number
      navigationMode: MapNavigationMode
      perspectiveEnabled: boolean
      viewportHeight?: number
    }
  | {
      type: 'ChangeNavigationMode'
      navigationMode: MapNavigationMode
      gpsCamera: Pick<MapCameraSnapshot, 'centerCoordinate' | 'zoomLevel'>
      followHeadingDeg: number
      perspectiveEnabled: boolean
      viewportHeight?: number
    }
  | {
      type: 'ChangePerspective'
      enabled: boolean
      currentCamera: MapCameraSnapshot | null
      fallbackZoomLevel: number
      navigationMode: MapNavigationMode
    }
  | {
      type: 'FrameRideHistoryPreview'
      selectionKey: string | null
      camera: MapCameraSnapshot
    }
  | {
      type: 'RefineRideHistoryRoute'
      selectionKey: string | null
      camera: MapCameraSnapshot
    }
  | {
      type: 'FocusCoordinate'
      coordinate: [number, number]
      currentCamera: MapCameraSnapshot | null
      fallbackZoomLevel: number
      navigationMode: MapNavigationMode
      perspectiveEnabled: boolean
    }
  | {
      type: 'EnterWeatherView'
      currentCamera: MapCameraSnapshot | null
      fallbackCenterCoordinate: [number, number]
      perspectiveEnabled: boolean
    }
  | {
      type: 'EnterLegalLimitsView'
      camera: MapCameraSnapshot
    }
  | {
      /** Frame a whole line of coordinates — today the Navigation path the rider is confirming. */
      type: 'FitRoute'
      camera: MapCameraSnapshot
    }

export interface MapCameraEffect {
  camera: Partial<MapCameraSnapshot>
}

export const initialMapCameraControllerState: MapCameraControllerState = {
  mode: { kind: 'liveFollow' },
  followZoomLevel: null,
}

function liveProfileForMode(navigationMode: MapNavigationMode): MapCameraProfileKey {
  return getMapCameraProfileForNavigationMode(navigationMode)
}

function buildLiveFollowCamera({
  gpsCamera,
  followHeadingDeg,
  navigationMode,
  perspectiveEnabled,
  viewportHeight,
  followZoomLevel,
  preserveHeading,
  enforceMinimums = true,
}: Extract<MapCameraIntent, { type: 'FollowLive' }> & {
  followZoomLevel: number | null
}): MapCameraSnapshot {
  const profile = liveProfileForMode(navigationMode)
  const baseZoom = followZoomLevel ?? gpsCamera.zoomLevel
  const zoomLevel = getProfileZoomLevel({
    profile,
    zoom: baseZoom,
    enforceMinimums: enforceMinimums && followZoomLevel == null,
  })
  const heading =
    navigationMode === 'freeRotate' && preserveHeading != null ? preserveHeading : followHeadingDeg
  return {
    ...gpsCamera,
    zoomLevel,
    heading,
    pitch: getPitchForProfileZoom({
      profile,
      zoom: zoomLevel,
      perspectiveEnabled,
      enforceMinimums: enforceMinimums && followZoomLevel == null,
    }),
    padding: getPaddingForProfile({ profile, viewportHeight }),
  }
}

export function reduceMapCameraIntent(
  state: MapCameraControllerState,
  intent: MapCameraIntent,
): { state: MapCameraControllerState; effect: MapCameraEffect | null } {
  if (intent.type === 'BrowseManually') {
    const mode: MapCameraMode =
      intent.historySelectionKey != null
        ? {
            kind: 'rideHistory',
            selectionKey: intent.historySelectionKey,
            phase: 'manualInspect',
          }
        : { kind: 'manualBrowse' }
    const alreadyBrowsing =
      state.mode.kind === mode.kind &&
      (mode.kind !== 'rideHistory' ||
        (state.mode.kind === 'rideHistory' &&
          state.mode.selectionKey === mode.selectionKey &&
          state.mode.phase === mode.phase))
    if (alreadyBrowsing) return { state, effect: null }

    return {
      state: {
        ...state,
        mode,
      },
      effect: null,
    }
  }

  if (intent.type === 'SetFollowZoom') {
    const nextState = {
      mode: { kind: 'liveFollow' } as const,
      followZoomLevel: intent.zoomLevel,
    }
    return {
      state: nextState,
      effect: {
        camera: buildLiveFollowCamera({
          type: 'FollowLive',
          gpsCamera: intent.gpsCamera,
          followHeadingDeg: intent.followHeadingDeg,
          navigationMode: intent.navigationMode,
          perspectiveEnabled: intent.perspectiveEnabled,
          viewportHeight: intent.viewportHeight,
          followZoomLevel: nextState.followZoomLevel,
        }),
      },
    }
  }

  if (intent.type === 'ChangePerspective') {
    const profile = liveProfileForMode(intent.navigationMode)
    const zoomLevel = intent.currentCamera?.zoomLevel ?? intent.fallbackZoomLevel
    return {
      state,
      effect: {
        camera: {
          pitch: getPitchForProfileZoom({
            profile,
            zoom: zoomLevel,
            perspectiveEnabled: intent.enabled,
            enforceMinimums: false,
          }),
        },
      },
    }
  }

  if (intent.type === 'FrameRideHistoryPreview') {
    return {
      state: {
        ...state,
        mode: { kind: 'rideHistory', selectionKey: intent.selectionKey, phase: 'preview' },
      },
      effect: { camera: intent.camera },
    }
  }

  if (intent.type === 'RefineRideHistoryRoute') {
    const currentMode = state.mode
    if (
      currentMode.kind !== 'rideHistory' ||
      currentMode.selectionKey !== intent.selectionKey ||
      currentMode.phase === 'manualInspect'
    ) {
      return { state, effect: null }
    }
    return {
      state: {
        ...state,
        mode: { kind: 'rideHistory', selectionKey: intent.selectionKey, phase: 'route' },
      },
      effect: { camera: intent.camera },
    }
  }

  if (intent.type === 'FocusCoordinate') {
    const profile = liveProfileForMode(intent.navigationMode)
    const zoomLevel = intent.currentCamera?.zoomLevel ?? intent.fallbackZoomLevel
    return {
      state: {
        ...state,
        mode: { kind: 'manualBrowse' },
      },
      effect: {
        camera: {
          centerCoordinate: intent.coordinate,
          zoomLevel,
          heading: profile === 'northUp' ? 0 : intent.currentCamera?.heading,
          pitch: getPitchForProfileZoom({
            profile,
            zoom: zoomLevel,
            perspectiveEnabled: intent.perspectiveEnabled,
            enforceMinimums: false,
          }),
        },
      },
    }
  }

  if (intent.type === 'EnterWeatherView') {
    const zoomLevel = 8
    return {
      state: {
        ...state,
        mode: { kind: 'manualBrowse' },
      },
      effect: {
        camera: {
          centerCoordinate: intent.fallbackCenterCoordinate,
          zoomLevel,
          heading: 0,
          pitch: getPitchForProfileZoom({
            profile: MAP_CAMERA_PROFILES.weather,
            zoom: zoomLevel,
            perspectiveEnabled: intent.perspectiveEnabled,
            enforceMinimums: false,
          }),
        },
      },
    }
  }

  if (intent.type === 'FitRoute' || intent.type === 'EnterLegalLimitsView') {
    return {
      state: {
        ...state,
        mode: { kind: 'manualBrowse' },
      },
      effect: { camera: intent.camera },
    }
  }

  const nextState = {
    mode: { kind: 'liveFollow' } as const,
    followZoomLevel: state.followZoomLevel,
  }
  return {
    state: nextState,
    effect: {
      camera: buildLiveFollowCamera({
        ...intent,
        type: 'FollowLive',
        followZoomLevel: state.followZoomLevel,
      }),
    },
  }
}
