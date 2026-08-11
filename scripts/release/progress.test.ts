import { describe, expect, test } from 'bun:test'
import type { WorkflowJob, WorkflowRun } from './contracts'
import { internalReleaseProgress, workflowElapsed } from './progress'

const job = (name: string, status: string, step?: string): WorkflowJob => ({
  id: 1,
  name,
  status,
  conclusion: status === 'completed' ? 'success' : null,
  started_at: '2026-07-31T10:00:00Z',
  completed_at: status === 'completed' ? '2026-07-31T10:05:00Z' : null,
  steps: step ? [{ name: step, status: 'in_progress', conclusion: null }] : [],
})

describe('internal release progress', () => {
  test('renders real completed jobs and active workflow step', () => {
    const progress = internalReleaseProgress([
      job('Release gates', 'completed'),
      job('Build signed artifacts once', 'in_progress', 'Build phone and Wear AABs'),
    ])
    expect(progress.completed).toBe(1)
    expect(progress.total).toBe(5)
    expect(progress.bar).toHaveLength(24)
    expect(progress.current).toBe('Build signed artifacts once')
    expect(progress.detail).toBe('Build phone and Wear AABs')
    expect(progress.remaining).toBe('about 20–45 min')
    expect(progress.stages.map((stage) => stage.state)).toEqual([
      'done',
      'active',
      'waiting',
      'waiting',
      'waiting',
    ])
  })

  test('formats elapsed workflow time', () => {
    const run = {
      run_started_at: '2026-07-31T10:00:00Z',
      created_at: '2026-07-31T09:59:00Z',
    } as WorkflowRun
    expect(workflowElapsed(run, Date.parse('2026-07-31T10:12:34Z'))).toBe('12m 34s')
  })

  test('freezes elapsed time when a run is complete', () => {
    const run = {
      status: 'completed',
      run_started_at: '2026-07-31T10:00:00Z',
      updated_at: '2026-07-31T10:42:10Z',
    } as WorkflowRun
    expect(workflowElapsed(run, Date.parse('2026-08-01T10:00:00Z'))).toBe('42m 10s')
  })
})
