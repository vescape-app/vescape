import type { MapOrientationMode } from '@/modules/map/constants/mapStyles'
import { zoomForMetersPerPixel } from '@/modules/map/lib/nearbyRadius'

import {
  getMapCameraProfileForOrientationMode,
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
  | { kind: 'previewPan'; returnTo: MapCameraMode }
  | {
      kind: 'rideHistory'
      selectionKey: string | null
      phase: 'preview' | 'route' | 'manualInspect'
    }

export function mapCameraModesEqual(a: MapCameraMode, b: MapCameraMode): boolean {
  if (a === b) return true
  if (a.kind !== b.kind) return false
  if (a.kind === 'previewPan' && b.kind === 'previewPan') {
    return mapCameraModesEqual(a.returnTo, b.returnTo)
  }
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
      orientationMode: MapOrientationMode
      perspectiveEnabled: boolean
      viewportHeight?: number
      preserveHeading?: number
      enforceMinimums?: boolean
    }
  | { type: 'BrowseManually'; historySelectionKey?: string | null }
  | { type: 'BeginPreviewPan' }
  | { type: 'EndPreviewPan' }
  | {
      type: 'CancelPreviewPan'
      liveCamera: MapCameraSnapshot | null
      anchorCamera: MapCameraSnapshot | null
    }
  | {
      type: 'SetFollowZoom'
      zoomLevel: number
      gpsCamera: Pick<MapCameraSnapshot, 'centerCoordinate' | 'zoomLevel'>
      followHeadingDeg: number
      orientationMode: MapOrientationMode
      perspectiveEnabled: boolean
      viewportHeight?: number
    }
  | {
      type: 'ChangePerspective'
      enabled: boolean
      currentCamera: MapCameraSnapshot | null
      fallbackZoomLevel: number
      orientationMode: MapOrientationMode
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
      orientationMode: MapOrientationMode
      perspectiveEnabled: boolean
    }
  | {
      type: 'EnterWeatherView'
      currentCamera: MapCameraSnapshot | null
      fallbackCenterCoordinate: [number, number]
      viewport: { width: number; height: number }
      perspectiveEnabled: boolean
    }
  | {
      type: 'EnterLegalLimitsView'
      camera: MapCameraSnapshot
    }
  | {
      type: 'FitRoute'
      camera: MapCameraSnapshot
    }

export interface MapCameraEffect {
  camera: Partial<MapCameraSnapshot>
}

/**
 * @parity /src/modules/weather/components/RadarRangeRings.tsx `RANGE_RING_KM`
 */
export function zoomForRadarView(
  latitude: number,
  viewport: { width: number; height: number },
): number {
  const fitPx = Math.min(viewport.width, viewport.height)
  if (fitPx <= 0) return RADAR_VIEW_FALLBACK_ZOOM
  const spanM = RADAR_VIEW_RADIUS_M * 2 * (1 + RADAR_VIEW_PADDING)
  return zoomForMetersPerPixel(spanM / fitPx, latitude)
}

const RADAR_VIEW_RADIUS_M = 100_000

const RADAR_VIEW_PADDING = 0.12
const RADAR_VIEW_FALLBACK_ZOOM = 7

export const initialMapCameraControllerState: MapCameraControllerState = {
  mode: { kind: 'liveFollow' },
  followZoomLevel: null,
}

function liveProfileForMode(orientationMode: MapOrientationMode): MapCameraProfileKey {
  return getMapCameraProfileForOrientationMode(orientationMode)
}

function buildLiveFollowCamera({
  gpsCamera,
  followHeadingDeg,
  orientationMode,
  perspectiveEnabled,
  viewportHeight,
  followZoomLevel,
  preserveHeading,
  enforceMinimums = true,
}: Extract<MapCameraIntent, { type: 'FollowLive' }> & {
  followZoomLevel: number | null
}): MapCameraSnapshot {
  const profile = liveProfileForMode(orientationMode)
  const baseZoom = followZoomLevel ?? gpsCamera.zoomLevel
  const zoomLevel = getProfileZoomLevel({
    profile,
    zoom: baseZoom,
    enforceMinimums: enforceMinimums && followZoomLevel == null,
  })
  const heading =
    orientationMode === 'freeRotate' && preserveHeading != null ? preserveHeading : followHeadingDeg
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
    padding: getPaddingForProfile({ profile, viewportHeight, zoom: zoomLevel }),
  }
}

function reduceBrowseManuallyIntent(
  state: MapCameraControllerState,
  intent: Extract<MapCameraIntent, { type: 'BrowseManually' }>,
): { state: MapCameraControllerState; effect: MapCameraEffect | null } {
  if (state.mode.kind === 'previewPan') return { state, effect: null }
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

function reducePreviewPanIntent(
  state: MapCameraControllerState,
  intent: Extract<
    MapCameraIntent,
    { type: 'BeginPreviewPan' | 'EndPreviewPan' | 'CancelPreviewPan' }
  >,
): { state: MapCameraControllerState; effect: MapCameraEffect | null } {
  if (intent.type === 'BeginPreviewPan') {
    if (state.mode.kind === 'previewPan') return { state, effect: null }
    return { state: { ...state, mode: { kind: 'previewPan', returnTo: state.mode } }, effect: null }
  }

  if (intent.type === 'EndPreviewPan') {
    if (state.mode.kind !== 'previewPan') return { state, effect: null }
    return { state: { ...state, mode: { kind: 'manualBrowse' } }, effect: null }
  }

  if (state.mode.kind !== 'previewPan') return { state, effect: null }
  const returnTo = state.mode.returnTo
  const camera =
    returnTo.kind === 'liveFollow'
      ? (intent.liveCamera ?? intent.anchorCamera)
      : intent.anchorCamera
  return {
    state: { ...state, mode: camera == null ? { kind: 'manualBrowse' } : returnTo },
    effect: camera == null ? null : { camera },
  }
}

export function reduceMapCameraIntent(
  state: MapCameraControllerState,
  intent: MapCameraIntent,
): { state: MapCameraControllerState; effect: MapCameraEffect | null } {
  if (intent.type === 'BrowseManually') return reduceBrowseManuallyIntent(state, intent)

  if (
    intent.type === 'BeginPreviewPan' ||
    intent.type === 'EndPreviewPan' ||
    intent.type === 'CancelPreviewPan'
  ) {
    return reducePreviewPanIntent(state, intent)
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
          orientationMode: intent.orientationMode,
          perspectiveEnabled: intent.perspectiveEnabled,
          viewportHeight: intent.viewportHeight,
          followZoomLevel: nextState.followZoomLevel,
        }),
      },
    }
  }

  if (intent.type === 'ChangePerspective') {
    const profile = liveProfileForMode(intent.orientationMode)
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
    const profile = liveProfileForMode(intent.orientationMode)
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
    const zoomLevel = zoomForRadarView(intent.fallbackCenterCoordinate[1], intent.viewport)
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
          padding: getPaddingForProfile({ profile: 'weather', zoom: zoomLevel }),
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
