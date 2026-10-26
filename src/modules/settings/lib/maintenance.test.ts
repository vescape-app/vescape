import { expect, test } from 'bun:test'
import type { MaintenanceJobState, MaintenanceState } from 'vescape-core'

import {
  maintenanceFailed,
  maintenanceJobDetail,
  maintenanceProgress,
} from '@/modules/settings/lib/maintenance'

function job(patch: Partial<MaintenanceJobState>): MaintenanceJobState {
  return {
    id: 'rideSummaries',
    status: 'done',
    done: 0,
    total: 0,
    lastRunAtMs: null,
    lastDurationMs: null,
    lastError: null,
    ...patch,
  }
}

function state(jobs: MaintenanceJobState[]): MaintenanceState {
  return { running: jobs.some((j) => j.status === 'running'), historyRevision: 0, jobs }
}

test('running job reports its position among the declared jobs', () => {
  const progress = maintenanceProgress(
    state([
      job({ status: 'running', done: 312, total: 780 }),
      job({ id: 'weatherBackfill', status: 'pending' }),
    ]),
  )
  expect(progress?.statusLine).toBe('Updating ride summaries · 312 of 780 hours · 1 of 2')
  expect(progress?.fraction).toBeCloseTo(0.4)
})

test('a run that has not counted its work yet shows no fraction', () => {
  expect(maintenanceProgress(state([job({ status: 'running' })]))).toMatchObject({
    fraction: null,
    statusLine: 'Updating ride summaries',
  })
  expect(maintenanceProgress(state([job({ status: 'done' })]))).toBeNull()
})

test('waiting for network is not a failure', () => {
  expect(maintenanceFailed(state([job({ status: 'waitingForNetwork' })]))).toBe(false)
  expect(maintenanceFailed(state([job({ status: 'failed', lastError: 'disk I/O' })]))).toBe(true)
})

test('job detail lists what is left, the last run and its error', () => {
  const now = 10 * 60_000
  expect(
    maintenanceJobDetail(job({ status: 'running', done: 312, total: 780, lastRunAtMs: now }), now),
  ).toBe('Running · 468 hours left · last run now')
  expect(
    maintenanceJobDetail(
      job({ status: 'failed', lastRunAtMs: 0, lastDurationMs: 90_000, lastError: 'disk I/O' }),
      now,
    ),
  ).toBe('Failed · last run 10m ago · took 2 min\ndisk I/O')
})
