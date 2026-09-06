import {
  ClockCountdownIcon,
  LinkBreakIcon,
  PauseIcon,
  PlugsConnectedIcon,
  StopIcon,
  WarningCircleIcon,
  type Icon,
} from 'phosphor-react-native'

import { theme } from '@/constants/theme'
import type { HistoryGpsSample, HistoryMarker } from '@/modules/history/store/historyStore'

export interface SelectedHistoryMarker {
  marker: HistoryMarker
  gps: HistoryGpsSample
}

export const HISTORY_MARKER_LABELS: Record<HistoryMarker['type'], string> = {
  app_stop: 'Recording stopped',
  auto_pause: 'Recording paused — idle',
  connected: 'Board connected',
  connection_lost: 'Board connection lost',
  disconnected: 'Board disconnected',
  error: 'Error',
  gap: 'History gap',
}

export const HISTORY_MARKER_ICONS: Record<HistoryMarker['type'], Icon> = {
  app_stop: StopIcon,
  auto_pause: PauseIcon,
  connected: PlugsConnectedIcon,
  connection_lost: LinkBreakIcon,
  disconnected: LinkBreakIcon,
  error: WarningCircleIcon,
  gap: ClockCountdownIcon,
}

export const HISTORY_MARKER_COLORS: Record<HistoryMarker['type'], string> = {
  app_stop: theme.palette.yellow.color,
  auto_pause: theme.status.warning.color,
  connected: theme.palette.green.color,
  connection_lost: theme.status.warning.color,
  disconnected: theme.status.warning.color,
  error: theme.status.error.color,
  gap: theme.palette.yellow.color,
}

function formatMarkerTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms} ms`
  const seconds = Math.round(ms / 1_000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`
}

export function buildHistoryMarkerMessage(selection: SelectedHistoryMarker): string {
  const { marker, gps } = selection
  const lines = [
    `Type: ${marker.type}`,
    `Meaning: ${HISTORY_MARKER_LABELS[marker.type]}`,
    `Marker time: ${formatMarkerTime(marker.occurredAtMs)}`,
    `Nearest GPS time: ${formatMarkerTime(gps.capturedAtMs)}`,
    `Time offset: ${formatDuration(Math.abs(gps.capturedAtMs - marker.occurredAtMs))}`,
    `Coordinate: ${gps.latitude.toFixed(7)}, ${gps.longitude.toFixed(7)}`,
  ]

  if (gps.accuracyM != null) lines.push(`GPS accuracy: ${gps.accuracyM.toFixed(1)} m`)
  if (marker.gapMs != null) lines.push(`Gap duration: ${formatDuration(marker.gapMs)}`)
  if (marker.message) lines.push(`Message: ${marker.message}`)

  return lines.join('\n')
}
