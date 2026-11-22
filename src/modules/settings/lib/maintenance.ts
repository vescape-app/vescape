import type { MaintenanceJobState, MaintenanceState } from 'vescape-core'

import { fmtRideDuration, fmtTimeAgo } from '@/helpers/format'

/**
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/telemetry/MaintenanceJobs.kt `MAINTENANCE_JOBS`
 * @parity /modules/vescape-core/ios/telemetry/MaintenanceJobs.swift `maintenanceJobs`
 */
export type MaintenanceJobId = 'telemetryStorage' | 'rideSummaries' | 'rideWeather' | 'cleanup'

const JOB_TITLES: Record<MaintenanceJobId, string> = {
  telemetryStorage: 'Telemetry storage',
  rideSummaries: 'Ride summaries',
  rideWeather: 'Ride weather',
  cleanup: 'Cleanup',
}

export function maintenanceJobTitle(id: string): string {
  return JOB_TITLES[id as MaintenanceJobId] ?? id
}

function fmtJobPercent(job: MaintenanceJobState): string {
  return `${Math.floor((Math.min(job.done, job.total) / job.total) * 100)}%`
}

export interface MaintenanceProgress {
  job: MaintenanceJobState
  fraction: number | null
  statusLine: string
}

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

function fmtJobDuration(ms: number): string {
  if (ms < 1000) return '< 1 s'
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`
  return fmtRideDuration(ms / 1000)
}

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
