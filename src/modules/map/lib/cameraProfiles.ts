import type { MapOrientationMode } from '@/modules/map/constants/mapStyles'

const MIN_ZOOM = 0
const GPS_HEADING_MIN_ZOOM = 16
const GPS_HEADING_VERTICAL_OFFSET_RATIO = 0.2
const PERSPECTIVE_MIN_ZOOM = 11
const PERSPECTIVE_MAX_ZOOM = 16

export type MapCameraProfileKey =
  | 'northUp'
  | 'freeRotate'
  | 'gpsHeading'
  | 'compass'
  | 'rideHistory'
  | 'weather'

export interface CameraPadding {
  paddingTop: number
  paddingRight: number
  paddingBottom: number
  paddingLeft: number
}

export interface CameraProfileDefinition {
  key: MapCameraProfileKey
  maxPitch: number
  minimumZoom?: number
  minimumPitch?: number
  verticalOffsetRatio?: number
  headingPolicy: 'north' | 'preserve' | 'gpsHeading' | 'compass'
  animationDurationMs: number
}

export interface LiveFollowCameraProfile {
  centerCoordinate: [number, number]
  zoomLevel: number
  heading: number
  pitch: number
  padding?: CameraPadding
}

export const ZERO_CAMERA_PADDING: CameraPadding = {
  paddingTop: 0,
  paddingRight: 0,
  paddingBottom: 0,
  paddingLeft: 0,
}

export const MAP_CAMERA_PROFILES: Record<MapCameraProfileKey, CameraProfileDefinition> = {
  northUp: {
    key: 'northUp',
    maxPitch: 45,
    headingPolicy: 'north',
    animationDurationMs: 350,
  },
  freeRotate: {
    key: 'freeRotate',
    maxPitch: 45,
    headingPolicy: 'preserve',
    animationDurationMs: 350,
  },
  gpsHeading: {
    key: 'gpsHeading',
    maxPitch: 56,
    minimumZoom: GPS_HEADING_MIN_ZOOM,
    minimumPitch: 56,
    verticalOffsetRatio: GPS_HEADING_VERTICAL_OFFSET_RATIO,
    headingPolicy: 'gpsHeading',
    animationDurationMs: 450,
  },
  compass: {
    key: 'compass',
    maxPitch: 52,
    minimumZoom: GPS_HEADING_MIN_ZOOM,
    minimumPitch: 52,
    verticalOffsetRatio: GPS_HEADING_VERTICAL_OFFSET_RATIO,
    headingPolicy: 'compass',
    animationDurationMs: 450,
  },
  rideHistory: {
    key: 'rideHistory',
    maxPitch: 24,
    headingPolicy: 'north',
    animationDurationMs: 350,
  },
  weather: {
    key: 'weather',
    maxPitch: 0,
    headingPolicy: 'north',
    animationDurationMs: 350,
  },
} as const

export function getMapCameraProfileForOrientationMode(
  orientationMode: MapOrientationMode,
): MapCameraProfileKey {
  if (orientationMode === 'gpsHeading') return 'gpsHeading'
  if (orientationMode === 'phoneHeading') return 'compass'
  if (orientationMode === 'freeRotate') return 'freeRotate'
  return 'northUp'
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function getPitchForProfileZoom({
  profile,
  zoom,
  perspectiveEnabled,
  enforceMinimums = true,
}: {
  profile: MapCameraProfileKey | CameraProfileDefinition
  zoom: number
  perspectiveEnabled: boolean
  enforceMinimums?: boolean
}) {
  if (!perspectiveEnabled) return 0
  const definition = typeof profile === 'string' ? MAP_CAMERA_PROFILES[profile] : profile
  const progress = clamp(
    (zoom - PERSPECTIVE_MIN_ZOOM) / (PERSPECTIVE_MAX_ZOOM - PERSPECTIVE_MIN_ZOOM),
    0,
    1,
  )
  const pitch = progress * definition.maxPitch
  return enforceMinimums && definition.minimumPitch != null
    ? Math.max(pitch, definition.minimumPitch)
    : pitch
}

export function getPitchForZoom(zoom: number, perspectiveEnabled: boolean) {
  return getPitchForProfileZoom({
    profile: 'northUp',
    zoom,
    perspectiveEnabled,
    enforceMinimums: false,
  })
}

export function getMapRevealPitch({
  basePitch,
  zoom,
  revealProgress,
  perspectiveEnabled,
}: {
  basePitch: number
  zoom: number
  revealProgress: number
  perspectiveEnabled: boolean
}) {
  const targetPitch = getPitchForZoom(zoom, perspectiveEnabled)
  const progress = clamp(revealProgress, 0, 1)
  return basePitch + (targetPitch - basePitch) * progress
}

export function getPaddingForProfile({
  profile,
  viewportHeight,
}: {
  profile: MapCameraProfileKey | CameraProfileDefinition
  viewportHeight?: number
}): CameraPadding {
  const definition = typeof profile === 'string' ? MAP_CAMERA_PROFILES[profile] : profile
  if (definition.verticalOffsetRatio == null || viewportHeight == null) return ZERO_CAMERA_PADDING
  return {
    paddingTop: Math.round(viewportHeight * definition.verticalOffsetRatio),
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
  }
}

export function getProfileZoomLevel({
  profile,
  zoom,
  enforceMinimums = true,
}: {
  profile: MapCameraProfileKey | CameraProfileDefinition
  zoom: number
  enforceMinimums?: boolean
}) {
  const definition = typeof profile === 'string' ? MAP_CAMERA_PROFILES[profile] : profile
  return clamp(
    enforceMinimums && definition.minimumZoom != null
      ? Math.max(zoom, definition.minimumZoom)
      : zoom,
    MIN_ZOOM,
    Number.POSITIVE_INFINITY,
  )
}

export function getLiveFollowCameraProfile({
  gpsCamera,
  followHeadingDeg,
  gpsHeadingMode,
  profileKey,
  perspectiveEnabled,
  viewportHeight,
  enforceHeadingMinimums = true,
}: {
  gpsCamera: Pick<LiveFollowCameraProfile, 'centerCoordinate' | 'zoomLevel'>
  followHeadingDeg: number
  gpsHeadingMode: boolean
  profileKey?: MapCameraProfileKey
  perspectiveEnabled: boolean
  viewportHeight?: number
  enforceHeadingMinimums?: boolean
}): LiveFollowCameraProfile {
  const profile = profileKey ?? (gpsHeadingMode ? 'gpsHeading' : 'northUp')
  const zoomLevel = getProfileZoomLevel({
    profile,
    zoom: gpsCamera.zoomLevel,
    enforceMinimums: enforceHeadingMinimums,
  })
  const pitch = getPitchForProfileZoom({
    profile,
    zoom: zoomLevel,
    perspectiveEnabled,
    enforceMinimums: enforceHeadingMinimums,
  })

  return {
    ...gpsCamera,
    zoomLevel,
    heading: followHeadingDeg,
    pitch,
    padding: getPaddingForProfile({ profile, viewportHeight }),
  }
}
