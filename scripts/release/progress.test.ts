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
    const progress = internalReleaseProgress(
      [
        job('Release gates', 'completed'),
        job('Build signed artifacts once', 'in_progress', 'Build phone and Wear AABs'),
      ],
      Date.parse('2026-07-31T10:00:00Z'),
    )
    expect(progress.completed).toBe(1)
    expect(progress.total).toBe(5)
    expect(progress.bar).toHaveLength(24)
    expect(progress.current).toBe('Build signed artifacts once')
    expect(progress.detail).toBe('Build phone and Wear AABs')
    expect(progress.remaining).toBe('about 14–25 min')
    expect(progress.stages.map((stage) => stage.state)).toEqual([
      'done',
      'active',
      'waiting',
      'waiting',
      'waiting',
    ])
  })

  test('remaining shrinks as the long build job runs', () => {
    const jobs = [
      job('Release gates', 'completed'),
      job('Build signed artifacts once', 'in_progress', 'Build phone and Wear AABs'),
    ]

    const early = internalReleaseProgress(jobs, Date.parse('2026-07-31T10:00:00Z')).remaining
    const late = internalReleaseProgress(jobs, Date.parse('2026-07-31T10:10:00Z')).remaining

    expect(early).toBe('about 14–25 min')
    expect(late).toBe('about 5–9 min')
  })

  test('only the last upload left reads as a couple of minutes', () => {
    const progress = internalReleaseProgress(
      [
        job('Release gates', 'completed'),
        job('Build signed artifacts once', 'completed'),
        job('Upload phone internal', 'completed'),
        job('Upload Wear internal', 'completed'),
        job('Publish release manifest', 'in_progress'),
      ],
      Date.parse('2026-07-31T10:00:00Z'),
    )

    expect(progress.remaining).toBe('under 2 min')
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

import { releaseWorkflowProgress } from './progress'

describe('shared release progress', () => {
  const run = { status: 'completed', conclusion: 'success' } as WorkflowRun
  const productionJobs = (failed: boolean): WorkflowJob[] => [
    {
      id: 1,
      name: 'Exact production release and GitHub Release',
      status: 'completed',
      conclusion: failed ? 'failure' : 'success',
      steps: [
        {
          name: 'Prove exact artifacts passed open testing',
          status: 'completed',
          conclusion: 'success',
        },
        { name: 'Apply phone production operation', status: 'completed', conclusion: 'success' },
        {
          name: 'Apply Wear production operation',
          status: 'completed',
          conclusion: failed ? 'failure' : 'success',
        },
        {
          name: 'Flip existing GitHub prerelease to latest release',
          status: 'completed',
          conclusion: failed ? 'skipped' : 'success',
        },
      ],
    } as WorkflowJob,
  ]

  test('keeps the completed production checklist visible with human labels', () => {
    const progress = releaseWorkflowProgress(productionJobs(false), run)
    expect(progress.current).toBe('Completed successfully')
    expect(progress.completed).toBe(progress.total)
    expect(progress.stages.map((stage) => stage.name)).toEqual([
      'Check the selected build',
      'Update the phone release',
      'Update the watch release',
      'Update the GitHub release',
    ])
    expect(progress.stages.every((stage) => stage.state === 'done')).toBe(true)
  })

  test('distinguishes failed and skipped steps even when the workflow is finished', () => {
    const progress = releaseWorkflowProgress(productionJobs(true), {
      ...run,
      conclusion: 'failure',
    })
    expect(progress.current).toBe('Stopped before completing')
    expect(progress.stages[2]?.state).toBe('failed')
    expect(progress.stages[3]?.state).toBe('skipped')
  })

  test('uses job progress for build workflows without promotion steps', () => {
    const progress = releaseWorkflowProgress(
      [
        {
          id: 2,
          started_at: null,
          completed_at: null,
          name: 'Build signed artifacts once',
          status: 'in_progress',
          conclusion: null,
          steps: [],
        } as WorkflowJob,
      ],
      { ...run, status: 'in_progress', conclusion: null },
    )
    expect(progress.stages[0]?.state).toBe('active')
    expect(progress.completed).toBe(0)
  })
})
