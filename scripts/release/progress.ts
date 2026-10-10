import type { WorkflowJob, WorkflowRun } from './contracts'

const stages = [
  'Release gates',
  'Build signed artifacts once',
  'Upload phone internal',
  'Upload Wear internal',
  'Publish release manifest',
] as const

/**
 * Typical minutes per job, measured over the successful Internal Release runs of Aug 2026.
 * `Build signed artifacts once` dominates and is the one that varies (11–19 min).
 */
const stageMinutes: Record<(typeof stages)[number], number> = {
  'Release gates': 2.5,
  'Build signed artifacts once': 12,
  'Upload phone internal': 2.2,
  'Upload Wear internal': 1,
  'Publish release manifest': 0.3,
}

const terminal = (job: WorkflowJob | undefined) => job?.status === 'completed'

/** Minutes already spent in a job that is still running; queued jobs have not started. */
function elapsedMinutes(job: WorkflowJob | undefined, now: number): number {
  if (job?.status !== 'in_progress') return 0
  const started = Date.parse(job.started_at ?? '')
  return Number.isFinite(started) ? Math.max(0, (now - started) / 60_000) : 0
}

/** Budget left across unfinished jobs, widened to the spread the real runs show. */
function remainingEstimate(byName: Map<string, WorkflowJob>, now: number): string {
  const left = stages.reduce((total, stage) => {
    const job = byName.get(stage)
    if (terminal(job)) return total
    return total + Math.max(0.2, stageMinutes[stage] - elapsedMinutes(job, now))
  }, 0)
  if (left <= 0) return 'done'
  if (left < 2) return 'under 2 min'
  return `about ${Math.round(left * 0.9)}–${Math.round(left * 1.6)} min`
}

export interface InternalReleaseProgress {
  bar: string
  completed: number
  total: number
  current: string
  detail: string | null
  remaining: string
  stages: Array<{ name: string; state: 'done' | 'active' | 'failed' | 'skipped' | 'waiting' }>
}

export function internalReleaseProgress(
  jobs: WorkflowJob[],
  now = Date.now(),
): InternalReleaseProgress {
  const byName = new Map(jobs.map((job) => [job.name, job]))
  const completed = stages.filter((stage) => terminal(byName.get(stage))).length
  const width = 24
  const filled = Math.floor((completed / stages.length) * width)
  const active = jobs.find((job) => job.status === 'in_progress')
  const queued = jobs.find((job) => job.status === 'queued')
  const currentJob = active ?? queued
  const currentStep = currentJob?.steps.find((step) => step.status === 'in_progress')
  const current =
    currentJob?.name ?? (completed === stages.length ? 'Finished' : 'Waiting for runner')
  const remaining = remainingEstimate(byName, now)

  return {
    bar: `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`,
    completed,
    total: stages.length,
    current,
    detail: currentStep?.name ?? null,
    remaining,
    stages: stages.map((stage) => {
      const job = byName.get(stage)
      const state =
        job?.status === 'in_progress'
          ? 'active'
          : job?.status === 'completed' && job.conclusion === 'success'
            ? 'done'
            : job?.status === 'completed' && job.conclusion === 'skipped'
              ? 'skipped'
              : job?.status === 'completed' && job.conclusion !== 'skipped'
                ? 'failed'
                : 'waiting'
      return { name: stage, state }
    }),
  }
}

export function workflowElapsed(run: WorkflowRun, now = Date.now()): string {
  const started = Date.parse(run.run_started_at ?? run.created_at ?? '')
  if (!Number.isFinite(started)) return 'unknown'
  const completed = run.status === 'completed' ? Date.parse(run.updated_at ?? '') : Number.NaN
  const end = Number.isFinite(completed) ? completed : now
  const seconds = Math.max(0, Math.floor((end - started) / 1_000))
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const remainder = seconds % 60
  return hours > 0
    ? `${hours}h ${String(minutes).padStart(2, '0')}m`
    : `${minutes}m ${String(remainder).padStart(2, '0')}s`
}

const releaseStepLabels: Record<string, string> = {
  'Prove exact artifacts passed open testing': 'Check the selected build',
  'Revalidate exact live Play state before mutation': 'Check Google Play',
  'Apply phone production operation': 'Update the phone release',
  'Apply Wear production operation': 'Update the watch release',
  'Flip existing GitHub prerelease to latest release': 'Update the GitHub release',
  'Tell the server Android now serves this version': 'Update the app version notice',
  'Validate both exact artifacts before any mutation': 'Check the selected build',
  'Promote exact phone code': 'Send the phone app to testers',
  'Promote exact Wear code': 'Send the watch app to testers',
}

/** Use real GitHub job/step state for every workflow, including its final failed steps. */
export function releaseWorkflowProgress(jobs: WorkflowJob[], run: WorkflowRun) {
  const selected = jobs.flatMap((job) => job.steps.filter((step) => releaseStepLabels[step.name]))
  const rows = selected.length ? selected : jobs
  const stages = rows.map((row) => ({
    name: releaseStepLabels[row.name] ?? row.name,
    state:
      row.status === 'completed'
        ? row.conclusion === 'success'
          ? ('done' as const)
          : row.conclusion === 'skipped'
            ? ('skipped' as const)
            : ('failed' as const)
        : row.status === 'in_progress'
          ? ('active' as const)
          : ('waiting' as const),
  }))
  const completed = stages.filter(
    (stage) => stage.state === 'done' || stage.state === 'failed' || stage.state === 'skipped',
  ).length
  const total = stages.length
  const filled = total ? Math.floor((completed / total) * 24) : 0
  return {
    stages,
    completed,
    total,
    bar: `${'█'.repeat(filled)}${'░'.repeat(24 - filled)}`,
    current:
      run.status === 'completed'
        ? run.conclusion === 'success'
          ? 'Completed successfully'
          : 'Stopped before completing'
        : (stages.find((stage) => stage.state === 'active')?.name ?? 'Waiting for GitHub'),
  }
}
