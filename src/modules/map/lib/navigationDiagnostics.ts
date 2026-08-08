import type { LocationEvent } from 'vescape-core'

import type { MapOrientationMode } from '@/modules/map/constants/mapStyles'

const MAP_ORIENTATION_MODE_LABELS: Record<MapOrientationMode, string> = {
  northUp: 'North up',
  gpsHeading: 'GPS heading',
  phoneHeading: 'Compass',
  freeRotate: 'Free rotate',
}

const MAP_STYLE_LABELS: Record<string, string> = {
  onedark: 'One Dark',
  outdoors: 'Outdoors',
  satellite: 'Satellite',
  mapy: 'Mapy.cz',
}

interface NavigationDiagnosticsViewModelArgs {
  mapOrientationMode: MapOrientationMode
  mapStyleKey: string
  gpsFix: LocationEvent | null
  retainedGpsBearingDeg: number | null
  retainedGpsBearingAt: number | null
  phoneHeadingDeg: number | null
  phoneHeadingStatus: string
  activeDisplayHeadingDeg: number | null
  cameraHeadingDeg: number | null
  fallbackReason: string | null
  updatedAt: number | null
  now: number
}

export interface NavigationDiagnosticsViewModel {
  selectedMode: string
  mapStyle: string
  readiness: string
  fallbackReason: string
  updatedAge: string
  gpsRows: DiagnosticRow[]
  headingRows: DiagnosticRow[]
  boardRows: DiagnosticRow[]
}

export interface DiagnosticRow {
  label: string
  value: string
}

const BOARD_UNAVAILABLE_ROWS = [
  'Automatic calibration state',
  'Calibration status',
  'Raw yaw',
  'GPS reference',
  'Offset',
  'Corrected heading',
  'Samples',
  'Confidence/error',
  'Rejection reason',
]

export function buildNavigationDiagnosticsViewModel({
  mapOrientationMode,
  mapStyleKey,
  gpsFix,
  retainedGpsBearingDeg,
  retainedGpsBearingAt,
  phoneHeadingDeg,
  phoneHeadingStatus,
  activeDisplayHeadingDeg,
  cameraHeadingDeg,
  fallbackReason,
  updatedAt,
  now,
}: NavigationDiagnosticsViewModelArgs): NavigationDiagnosticsViewModel {
  const selectedMode = MAP_ORIENTATION_MODE_LABELS[mapOrientationMode] ?? mapOrientationMode
  const mapStyle = MAP_STYLE_LABELS[mapStyleKey] ?? mapStyleKey
  const gpsReady = gpsFix != null
  const phoneReady = phoneHeadingDeg != null && phoneHeadingStatus === 'ready'
  const headingReady =
    mapOrientationMode === 'northUp' ||
    mapOrientationMode === 'freeRotate' ||
    (mapOrientationMode === 'gpsHeading' && retainedGpsBearingDeg != null) ||
    (mapOrientationMode === 'phoneHeading' && phoneReady)

  return {
    selectedMode,
    mapStyle,
    readiness: headingReady ? 'ready' : 'waiting',
    fallbackReason: fallbackReason ? formatFallbackReason(fallbackReason) : 'none',
    updatedAge: formatAge(updatedAt, now),
    gpsRows: [
      { label: 'GPS status', value: gpsReady ? 'available' : 'unavailable' },
      { label: 'Raw bearing', value: formatDegrees(gpsFix?.bearingDeg ?? null) },
      { label: 'Retained bearing', value: formatDegrees(retainedGpsBearingDeg) },
      { label: 'Retained age', value: formatAge(retainedGpsBearingAt, now) },
      { label: 'Fix age', value: formatAge(gpsFix?.timestamp ?? null, now) },
      { label: 'Speed', value: formatSpeed(gpsFix?.speedMps ?? null) },
      { label: 'Accuracy', value: formatMeters(gpsFix?.accuracyM ?? null) },
    ],
    headingRows: [
      { label: 'Compass status', value: phoneHeadingStatus },
      { label: 'Compass heading', value: formatDegrees(phoneHeadingDeg) },
      { label: 'Active display heading', value: formatDegrees(activeDisplayHeadingDeg) },
      { label: 'Camera heading', value: formatDegrees(cameraHeadingDeg) },
    ],
    boardRows: BOARD_UNAVAILABLE_ROWS.map((label) => ({ label, value: 'unavailable' })),
  }
}

export function getNavigationFallbackReason({
  mapOrientationMode,
  gpsFix,
  retainedGpsBearingDeg,
  phoneHeadingDeg,
  phoneHeadingStatus,
}: Pick<
  NavigationDiagnosticsViewModelArgs,
  | 'mapOrientationMode'
  | 'gpsFix'
  | 'retainedGpsBearingDeg'
  | 'phoneHeadingDeg'
  | 'phoneHeadingStatus'
>): string | null {
  if (mapOrientationMode === 'gpsHeading') {
    if (!gpsFix) return 'gps_fix_unavailable'
    if (retainedGpsBearingDeg == null) return 'gps_bearing_unavailable'
  }
  if (mapOrientationMode === 'phoneHeading') {
    if (phoneHeadingDeg == null) return `phone_heading_${phoneHeadingStatus || 'unavailable'}`
  }
  return null
}

function formatDegrees(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'unavailable'
  return `${Math.round(normalizeDegrees(value))} deg`
}

function formatSpeed(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'unavailable'
  return `${(value * 3.6).toFixed(1)} km/h`
}

function formatMeters(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'unavailable'
  return `${Math.round(value)} m`
}

function formatAge(timestamp: number | null, now: number): string {
  if (timestamp == null || !Number.isFinite(timestamp)) return 'unavailable'
  const ageMs = Math.max(0, now - timestamp)
  if (ageMs < 1_000) return `${Math.round(ageMs)} ms`
  return `${(ageMs / 1_000).toFixed(1)} s`
}

function formatFallbackReason(reason: string): string {
  return reason.replace(/^phone_heading_/, 'compass_').replaceAll('_', ' ')
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360
}
