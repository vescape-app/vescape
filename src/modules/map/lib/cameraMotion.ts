import { MAP_DEFAULTS } from '@/modules/map/constants/mapStyles'

export const MIN_ZOOM = 0
export const MAP_REVEAL_ZOOM_OUT_DELTA = 0.65
const HISTORY_PREVIEW_ZOOM_OUT_DELTA = 0.8

export interface CameraSnapshot {
  centerCoordinate: [number, number]
  zoomLevel: number
  heading: number
  pitch: number
  padding?: {
    paddingTop: number
    paddingRight: number
    paddingBottom: number
    paddingLeft: number
  }
}

export interface HistoryPreviewTarget {
  latitude: number
  longitude: number
  minLatitude: number | null
  maxLatitude: number | null
  minLongitude: number | null
  maxLongitude: number | null
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function getHistoryPreviewBounds(preview: HistoryPreviewTarget) {
  if (
    preview.minLatitude == null ||
    preview.maxLatitude == null ||
    preview.minLongitude == null ||
    preview.maxLongitude == null ||
    (preview.minLatitude === preview.maxLatitude && preview.minLongitude === preview.maxLongitude)
  ) {
    return null
  }
  return {
    ne: [preview.maxLongitude, preview.maxLatitude] as [number, number],
    sw: [preview.minLongitude, preview.minLatitude] as [number, number],
  }
}

export function getHistoryPreviewZoom(zoomLevel: number) {
  return clamp(zoomLevel - HISTORY_PREVIEW_ZOOM_OUT_DELTA, MIN_ZOOM, MAP_DEFAULTS.maxZoom)
}

export function liveFollowKey(
  timestamp: number,
  camera: Pick<CameraSnapshot, 'heading' | 'zoomLevel'>,
) {
  return `${timestamp}:${camera.heading.toFixed(2)}:${camera.zoomLevel.toFixed(2)}`
}
