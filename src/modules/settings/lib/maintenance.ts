import type { MaintenanceJobState, MaintenanceState } from 'vescape-core'

import { fmtRideDuration, fmtTimeAgo } from '@/helpers/format'

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/MaintenanceJobs.kt `MAINTENANCE_JOBS`
 * @parity /modules/vescape-core/ios/telemetry/MaintenanceJobs.swift `maintenanceJobs`
 */
export type MaintenanceJobId = 'telemetryStorage' | 'rideSummaries' | 'rideWeather'

/** Rider-facing names for the declared Maintenance Jobs; an unknown id falls back to itself. */
const JOB_TITLES: Record<MaintenanceJobId, string> = {
  telemetryStorage: 'Telemetry storage',
  rideSummaries: 'Ride summaries',
  rideWeather: 'Ride weather',
}

export function maintenanceJobTitle(id: string): string {
  return JOB_TITLES[id as MaintenanceJobId] ?? id
}

/**
 * Jobs count in internal units (telemetry hours, minutes, ride days) that riders read as time
 * left, so progress shows as a percentage.
 */
function fmtJobPercent(job: MaintenanceJobState): string {
  return `${Math.floor((Math.min(job.done, job.total) / job.total) * 100)}%`
}

export interface MaintenanceProgress {
  job: MaintenanceJobState
  /** 0–1 when the running job knows its total yet. */
  fraction: number | null
  /** e.g. "Updating ride summaries · 40% · 1 of 2" */
  statusLine: string
}

/** The running job and how far it got, or null while nothing runs. */
export function maintenanceProgress(state: MaintenanceState | null): MaintenanceProgress | null {
  if (!state?.running) return null
  const index = state.jobs.findIndex((job) => job.status === 'running')
  const job = state.jobs[index]
  if (!job) return null
  const fraction = job.total > 0 ? Math.min(1, job.done / job.total) : null
  const parts = [`Updating ${maintenanceJobTitle(job.id).toLowerCase()}`]
  if (job.total > 0) parts.push(fmtJobPercent(job))
  if (state.jobs.length > 1) parts.push(`${index + 1} of ${state.jobs.length}`)
  return { job, fraction, statusLine: parts.join(' · ') }
}

/** A failed job earns a warning; waiting for network is not a failure. */
export function maintenanceFailed(state: MaintenanceState | null): boolean {
  return state?.jobs.some((job) => job.status === 'failed') ?? false
}

const STATUS_LABELS: Record<MaintenanceJobState['status'], string> = {
  pending: 'Waiting',
  running: 'Running',
  done: 'Done',
  waitingForNetwork: 'Waiting for network',
  failed: 'Failed',
}

/** Jobs often finish in seconds, which ride-duration minutes would round up to "1 min". */
function fmtJobDuration(ms: number): string {
  if (ms < 1000) return '< 1 s'
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`
  return fmtRideDuration(ms / 1000)
}

/** One job's Database screen line: status, progress or last run and duration, and last error. */
export function maintenanceJobDetail(job: MaintenanceJobState, nowMs = Date.now()): string {
  const parts = [STATUS_LABELS[job.status]]
  const running = job.status === 'running'
  if (running && job.total > 0) parts.push(fmtJobPercent(job))
  if (job.lastRunAtMs != null && !running)
    parts.push(`last run ${fmtTimeAgo(job.lastRunAtMs, nowMs)}`)
  if (job.lastDurationMs != null && job.status !== 'running') {
    parts.push(`took ${fmtJobDuration(job.lastDurationMs)}`)
  }
  const line = parts.join(' · ')
  return job.lastError ? `${line}\n${job.lastError}` : line
}
