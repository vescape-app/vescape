import type { WorkflowJob, WorkflowRun } from './contracts'

const stages = [
  'Release gates',
  'Build signed artifacts once',
  'Upload phone internal',
  'Upload Wear internal',
  'Publish release manifest',
] as const

const terminal = (job: WorkflowJob | undefined) => job?.status === 'completed'

export interface InternalReleaseProgress {
  bar: string
  completed: number
  total: number
  current: string
  detail: string | null
  remaining: string
  stages: Array<{ name: string; state: 'done' | 'active' | 'failed' | 'skipped' | 'waiting' }>
}

export function internalReleaseProgress(jobs: WorkflowJob[]): InternalReleaseProgress {
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
  const nextIncomplete = stages.findIndex((stage) => !terminal(byName.get(stage)))
  const remaining =
    nextIncomplete <= 0
      ? 'about 30–60 min'
      : nextIncomplete === 1
        ? 'about 20–45 min'
        : nextIncomplete <= 3
          ? 'about 5–15 min'
          : nextIncomplete === 4
            ? 'about 1–3 min'
            : 'done'

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
