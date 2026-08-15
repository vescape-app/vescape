import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  ProductionManifest,
  ProductionOperation,
  PromotionManifest,
  ReleaseManifest,
  WorkflowJob,
  WorkflowRun,
} from './contracts'
import { parseProductionManifest, parsePromotionManifest, parseReleaseManifest } from './contracts'
import { releaseNotesPath } from './prepare'

const WORKFLOW_FILE = 'release-android.yml'
const IOS_WORKFLOW_FILE = 'release-ios.yml'
const PROMOTION_WORKFLOW_FILE = 'promote-open.yml'
const PRODUCTION_WORKFLOW_FILE = 'promote-production.yml'

interface GhResult {
  exitCode: number
  stdout: string
  stderr: string
}

async function gh(args: string[]): Promise<GhResult> {
  const process = Bun.spawn(['gh', ...args], { stdout: 'pipe', stderr: 'pipe' })
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() }
}

async function checkedGh(args: string[], label: string): Promise<string> {
  const result = await gh(args)
  if (result.exitCode !== 0) throw new Error(`${label}: ${result.stderr || result.stdout}`)
  return result.stdout
}

async function git(args: string[]): Promise<GhResult> {
  const process = Bun.spawn(['git', ...args], { stdout: 'pipe', stderr: 'pipe' })
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() }
}

async function checkedGit(args: string[], label: string): Promise<string> {
  const result = await git(args)
  if (result.exitCode !== 0) throw new Error(`${label}: ${result.stderr || result.stdout}`)
  return result.stdout
}

export interface DispatchPayload {
  ref: string
  inputs: {
    source_sha: string
    request_id: string
  }
}

export interface PromotionDispatchPayload {
  ref: string
  inputs: {
    request_id: string
    candidate_run_id: string
    source_sha: string
    marketing_version: string
    phone_code: string
    wear_code: string
  }
}

export interface ReleaseTrackConfig {
  phoneInternal: string
  phoneOpen: string
  phoneProduction: string
  wearInternal: string
  wearOpen: string
  wearProduction: string
}

export interface ProductionCandidate {
  manifest: ReleaseManifest
  open: PromotionManifest
  openPromotionRunId: number
}

export interface ProductionDispatchPayload {
  ref: string
  inputs: {
    request_id: string
    operation: ProductionOperation
    open_promotion_run_id: string
    candidate_run_id: string
    source_sha: string
    marketing_version: string
    phone_code: string
    wear_code: string
    rollout_percentage: string
  }
}

interface ActionsArtifact {
  name: string
  expired: boolean
  created_at?: string
  workflow_run?: { id?: number }
}

export interface ArtifactRun {
  runId: number
  createdAt: string | null
}

export function createDispatchPayload(
  sourceSha: string,
  requestId: string,
  workflowRef = 'main',
): DispatchPayload {
  if (!/^[0-9a-f]{40}$/i.test(sourceSha))
    throw new Error('Source SHA must be a full 40-character SHA')
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new Error('Request ID must be a UUID')
  return {
    ref: workflowRef,
    inputs: { source_sha: sourceSha.toLowerCase(), request_id: requestId },
  }
}

export function createPromotionDispatchPayload(
  manifest: ReleaseManifest,
  requestId: string,
  workflowRef = 'main',
): PromotionDispatchPayload {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new Error('Request ID must be a UUID')
  if (!/^[0-9a-f]{40}$/i.test(manifest.sourceSha))
    throw new Error('Candidate source SHA must be a full 40-character SHA')
  if (manifest.uploads.phone !== 'succeeded' || manifest.uploads.wear !== 'succeeded')
    throw new Error('Candidate must have both successful internal uploads')
  return {
    ref: workflowRef,
    inputs: {
      request_id: requestId,
      candidate_run_id: String(manifest.workflow.runId),
      source_sha: manifest.sourceSha.toLowerCase(),
      marketing_version: manifest.marketingVersion,
      phone_code: String(manifest.versionCodes.phone),
      wear_code: String(manifest.versionCodes.wear),
    },
  }
}

export function createProductionDispatchPayload(
  candidate: ProductionCandidate,
  operation: ProductionOperation,
  requestId: string,
  rolloutPercentage?: number,
  workflowRef = 'main',
): ProductionDispatchPayload {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new Error('Request ID must be a UUID')
  if (!['promote', 'status', 'halt', 'resume', 'advance'].includes(operation))
    throw new Error(`Invalid production operation "${operation}"`)
  if (!Number.isSafeInteger(candidate.openPromotionRunId) || candidate.openPromotionRunId < 1)
    throw new Error('Open-promotion run ID must be a positive integer')
  if (operation === 'promote' || operation === 'advance') {
    if (
      typeof rolloutPercentage !== 'number' ||
      !Number.isFinite(rolloutPercentage) ||
      rolloutPercentage <= 0 ||
      rolloutPercentage > 100
    ) {
      throw new Error('Rollout percentage must be greater than 0 and at most 100')
    }
  }
  const { manifest, open } = candidate
  if (
    open.phone.status === 'failed' ||
    open.wear.status === 'failed' ||
    open.candidateRunId !== manifest.workflow.runId ||
    open.sourceSha !== manifest.sourceSha ||
    open.marketingVersion !== manifest.marketingVersion ||
    open.phone.versionCode !== manifest.versionCodes.phone ||
    open.wear.versionCode !== manifest.versionCodes.wear
  ) {
    throw new Error('Candidate is not an exact successful open-tested release')
  }
  return {
    ref: workflowRef,
    inputs: {
      request_id: requestId,
      operation,
      open_promotion_run_id: String(candidate.openPromotionRunId),
      candidate_run_id: String(manifest.workflow.runId),
      source_sha: manifest.sourceSha,
      marketing_version: manifest.marketingVersion,
      phone_code: String(manifest.versionCodes.phone),
      wear_code: String(manifest.versionCodes.wear),
      rollout_percentage: rolloutPercentage === undefined ? '0' : String(rolloutPercentage),
    },
  }
}

export async function verifyGhAuthentication(): Promise<void> {
  await checkedGh(['auth', 'status'], 'GitHub authentication failed')
}

export async function repositoryName(): Promise<string> {
  const value = await checkedGh(
    ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
    'Cannot resolve repository',
  )
  if (!/^[^/]+\/[^/]+$/.test(value)) throw new Error(`Invalid GitHub repository "${value}"`)
  return value
}

export async function repositoryDefaultBranch(repo: string): Promise<string> {
  const value = await checkedGh(
    ['api', `repos/${repo}`, '--jq', '.default_branch'],
    'Cannot resolve trusted workflow branch',
  )
  if (!/^[0-9A-Za-z._/-]+$/.test(value)) throw new Error(`Invalid default branch "${value}"`)
  return value
}

export async function resolveSourceSha(input: string): Promise<string> {
  const ref = input.trim()
  const result = await git(['rev-parse', '--verify', `${ref}^{commit}`])
  if (result.exitCode !== 0) throw new Error(`Cannot resolve commit "${ref}": ${result.stderr}`)
  return result.stdout.toLowerCase()
}

export interface SourceRefPreview {
  sha: string
  subject: string
  releasedBranch: boolean
}

/** Non-throwing preview of what a typed ref points at, so the build screen can show it live. */
export async function describeSourceRef(input: string): Promise<SourceRefPreview | null> {
  const ref = input.trim()
  if (!ref) return null
  const described = await git(['show', '-s', '--format=%H%n%s', `${ref}^{commit}`])
  if (described.exitCode !== 0) return null
  const [sha = '', ...subjectLines] = described.stdout.split('\n')
  const ancestry = await git(['merge-base', '--is-ancestor', sha, 'origin/main'])
  return {
    sha: sha.toLowerCase(),
    subject: subjectLines.join(' ').trim(),
    releasedBranch: ancestry.exitCode === 0,
  }
}

export async function verifyRemoteCommit(repo: string, sourceSha: string): Promise<void> {
  await checkedGh(
    ['api', `repos/${repo}/commits/${sourceSha}`, '--silent'],
    'Commit is not available on GitHub',
  )
}

export async function marketingVersion(repo: string, sourceSha: string): Promise<string> {
  const encodedPath = encodeURIComponent('package.json')
  const content = await checkedGh(
    ['api', `repos/${repo}/contents/${encodedPath}?ref=${sourceSha}`, '--jq', '.content'],
    'Cannot read package.json at source commit',
  )
  const packageJson = JSON.parse(
    Buffer.from(content.replace(/\s/g, ''), 'base64').toString('utf8'),
  ) as {
    version?: unknown
  }
  if (typeof packageJson.version !== 'string') throw new Error('Source package.json has no version')
  return packageJson.version
}

async function dispatchBuildWorkflow(
  repo: string,
  workflowFile: string,
  payload: DispatchPayload,
  label: string,
): Promise<void> {
  await checkedGh(
    [
      'api',
      '--method',
      'POST',
      `repos/${repo}/actions/workflows/${workflowFile}/dispatches`,
      '--raw-field',
      `ref=${payload.ref}`,
      '--raw-field',
      `inputs[source_sha]=${payload.inputs.source_sha}`,
      '--raw-field',
      `inputs[request_id]=${payload.inputs.request_id}`,
    ],
    label,
  )
}

export async function dispatchInternalBuild(repo: string, payload: DispatchPayload): Promise<void> {
  await dispatchBuildWorkflow(repo, WORKFLOW_FILE, payload, 'Workflow dispatch failed')
}

export async function dispatchIosInternalBuild(
  repo: string,
  payload: DispatchPayload,
): Promise<void> {
  await dispatchBuildWorkflow(repo, IOS_WORKFLOW_FILE, payload, 'iOS workflow dispatch failed')
}

export async function dispatchOpenPromotion(
  repo: string,
  payload: PromotionDispatchPayload,
): Promise<void> {
  await checkedGh(
    [
      'api',
      '--method',
      'POST',
      `repos/${repo}/actions/workflows/${PROMOTION_WORKFLOW_FILE}/dispatches`,
      '--raw-field',
      `ref=${payload.ref}`,
      ...Object.entries(payload.inputs).flatMap(([key, value]) => [
        '--raw-field',
        `inputs[${key}]=${value}`,
      ]),
    ],
    'Open-promotion workflow dispatch failed',
  )
}

export async function dispatchProduction(
  repo: string,
  payload: ProductionDispatchPayload,
): Promise<void> {
  await checkedGh(
    [
      'api',
      '--method',
      'POST',
      `repos/${repo}/actions/workflows/${PRODUCTION_WORKFLOW_FILE}/dispatches`,
      '--raw-field',
      `ref=${payload.ref}`,
      ...Object.entries(payload.inputs).flatMap(([key, value]) => [
        '--raw-field',
        `inputs[${key}]=${value}`,
      ]),
    ],
    'Production workflow dispatch failed',
  )
}

function parseRunsByTitle(value: unknown, title: string): WorkflowRun | null {
  if (!value || typeof value !== 'object') throw new Error('Workflow runs response is invalid')
  const runs = (value as { workflow_runs?: unknown }).workflow_runs
  if (!Array.isArray(runs)) throw new Error('Workflow runs response has no workflow_runs')
  const match = runs.find(
    (run): run is WorkflowRun =>
      !!run &&
      typeof run === 'object' &&
      (run as WorkflowRun).display_title === title &&
      typeof (run as WorkflowRun).id === 'number',
  )
  return match ?? null
}

export function parseWorkflowRuns(value: unknown, requestId: string): WorkflowRun | null {
  return parseRunsByTitle(value, `Internal ${requestId}`)
}

export function parseIosWorkflowRuns(value: unknown, requestId: string): WorkflowRun | null {
  return parseRunsByTitle(value, `iOS ${requestId}`)
}

export function parsePromotionWorkflowRuns(value: unknown, requestId: string): WorkflowRun | null {
  if (!value || typeof value !== 'object') throw new Error('Workflow runs response is invalid')
  const runs = (value as { workflow_runs?: unknown }).workflow_runs
  if (!Array.isArray(runs)) throw new Error('Workflow runs response has no workflow_runs')
  const title = `Open ${requestId}`
  return (
    runs.find(
      (run): run is WorkflowRun =>
        !!run &&
        typeof run === 'object' &&
        (run as WorkflowRun).display_title === title &&
        typeof (run as WorkflowRun).id === 'number',
    ) ?? null
  )
}

export function parseProductionWorkflowRuns(value: unknown, requestId: string): WorkflowRun | null {
  if (!value || typeof value !== 'object') throw new Error('Workflow runs response is invalid')
  const runs = (value as { workflow_runs?: unknown }).workflow_runs
  if (!Array.isArray(runs)) throw new Error('Workflow runs response has no workflow_runs')
  const title = `Production ${requestId}`
  return (
    runs.find(
      (run): run is WorkflowRun =>
        !!run &&
        typeof run === 'object' &&
        (run as WorkflowRun).display_title === title &&
        typeof (run as WorkflowRun).id === 'number',
    ) ?? null
  )
}

export async function findDispatchedRun(
  repo: string,
  requestId: string,
): Promise<WorkflowRun | null> {
  const output = await checkedGh(
    [
      'api',
      `repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=50`,
    ],
    'Cannot list workflow runs',
  )
  return parseWorkflowRuns(JSON.parse(output), requestId)
}

export async function findDispatchedIosRun(
  repo: string,
  requestId: string,
): Promise<WorkflowRun | null> {
  const output = await checkedGh(
    [
      'api',
      `repos/${repo}/actions/workflows/${IOS_WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=50`,
    ],
    'Cannot list iOS workflow runs',
  )
  return parseIosWorkflowRuns(JSON.parse(output), requestId)
}

export async function findPromotionRun(
  repo: string,
  requestId: string,
): Promise<WorkflowRun | null> {
  const output = await checkedGh(
    [
      'api',
      `repos/${repo}/actions/workflows/${PROMOTION_WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=50`,
    ],
    'Cannot list open-promotion workflow runs',
  )
  return parsePromotionWorkflowRuns(JSON.parse(output), requestId)
}

export async function findProductionRun(
  repo: string,
  requestId: string,
): Promise<WorkflowRun | null> {
  const output = await checkedGh(
    [
      'api',
      `repos/${repo}/actions/workflows/${PRODUCTION_WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=50`,
    ],
    'Cannot list production workflow runs',
  )
  return parseProductionWorkflowRuns(JSON.parse(output), requestId)
}

export async function getWorkflowRun(repo: string, runId: number): Promise<WorkflowRun> {
  const output = await checkedGh(
    ['api', `repos/${repo}/actions/runs/${runId}`],
    'Cannot read workflow run',
  )
  return JSON.parse(output) as WorkflowRun
}

export function parseInternalWorkflowRuns(value: unknown): WorkflowRun[] {
  if (!value || typeof value !== 'object') throw new Error('Workflow runs response is invalid')
  const runs = (value as { workflow_runs?: unknown }).workflow_runs
  if (!Array.isArray(runs)) throw new Error('Workflow runs response has no workflow_runs')
  return runs.filter(
    (run): run is WorkflowRun =>
      !!run &&
      typeof run === 'object' &&
      typeof (run as WorkflowRun).id === 'number' &&
      typeof (run as WorkflowRun).html_url === 'string' &&
      typeof (run as WorkflowRun).display_title === 'string' &&
      /^Internal [0-9a-f-]{36}$/i.test((run as WorkflowRun).display_title),
  )
}

export async function listInternalWorkflowRuns(repo: string): Promise<WorkflowRun[]> {
  const output = await checkedGh(
    [
      'api',
      `repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=20`,
    ],
    'Cannot list Internal workflow runs',
  )
  return parseInternalWorkflowRuns(JSON.parse(output))
}

export function parseWorkflowJobs(value: unknown): WorkflowJob[] {
  if (!value || typeof value !== 'object') throw new Error('Workflow jobs response is invalid')
  const jobs = (value as { jobs?: unknown }).jobs
  if (!Array.isArray(jobs)) throw new Error('Workflow jobs response has no jobs')
  return jobs.filter(
    (job): job is WorkflowJob =>
      !!job &&
      typeof job === 'object' &&
      typeof (job as WorkflowJob).id === 'number' &&
      typeof (job as WorkflowJob).name === 'string' &&
      typeof (job as WorkflowJob).status === 'string' &&
      Array.isArray((job as WorkflowJob).steps),
  )
}

export async function getWorkflowJobs(repo: string, runId: number): Promise<WorkflowJob[]> {
  const output = await checkedGh(
    ['api', `repos/${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=100`],
    'Cannot read workflow progress',
  )
  return parseWorkflowJobs(JSON.parse(output))
}

export function parseFailedWorkflowJobs(value: unknown): string[] {
  if (!value || typeof value !== 'object') throw new Error('Workflow jobs response is invalid')
  const jobs = (value as { jobs?: unknown }).jobs
  if (!Array.isArray(jobs)) throw new Error('Workflow jobs response has no jobs')
  return jobs
    .filter(
      (job): job is WorkflowJob =>
        !!job &&
        typeof job === 'object' &&
        typeof (job as WorkflowJob).name === 'string' &&
        (job as WorkflowJob).conclusion !== 'success' &&
        (job as WorkflowJob).conclusion !== 'skipped',
    )
    .map((job) => job.name)
}

export async function failedWorkflowJobs(repo: string, runId: number): Promise<string[]> {
  const output = await checkedGh(
    ['api', `repos/${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=100`],
    'Cannot read workflow jobs',
  )
  return parseFailedWorkflowJobs(JSON.parse(output))
}

export async function downloadManifest(runId: number): Promise<ReleaseManifest> {
  const directory = await mkdtemp(join(tmpdir(), 'vescape-release-'))
  try {
    await checkedGh(
      ['run', 'download', String(runId), '--name', 'release-manifest', '--dir', directory],
      'Cannot download release manifest',
    )
    const contents = await readFile(join(directory, 'release-manifest.json'), 'utf8')
    return parseWorkflowArtifact(contents, 'Release manifest', parseReleaseManifest)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export class InvalidWorkflowArtifactError extends Error {}

export function parseArtifactJson(contents: string, label: string): unknown {
  if (!contents.trim())
    throw new InvalidWorkflowArtifactError(`${label} is empty; inspect its workflow run`)
  try {
    return JSON.parse(contents)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new InvalidWorkflowArtifactError(
      `${label} is invalid JSON; inspect its workflow run (${detail})`,
    )
  }
}

function parseWorkflowArtifact<T>(
  contents: string,
  label: string,
  parse: (value: unknown) => T,
): T {
  const value = parseArtifactJson(contents, label)
  try {
    return parse(value)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new InvalidWorkflowArtifactError(
      `${label} is invalid; inspect its workflow run (${detail})`,
    )
  }
}

/**
 * Downloads artifacts in id order, skipping ones whose payload no longer parses. `limit` stops
 * after that many valid artifacts — the dashboard only needs the newest per track, and each
 * download is a slow `gh run download` round trip.
 */
export async function loadValidWorkflowArtifacts<T>(
  runIds: readonly number[],
  load: (runId: number) => Promise<T>,
  limit = Number.POSITIVE_INFINITY,
): Promise<Array<{ runId: number; artifact: T }>> {
  const artifacts: Array<{ runId: number; artifact: T }> = []
  for (const runId of runIds) {
    if (artifacts.length >= limit) break
    try {
      artifacts.push({ runId, artifact: await load(runId) })
    } catch (error) {
      if (error instanceof InvalidWorkflowArtifactError) continue
      throw error
    }
  }
  return artifacts
}

export interface WorkflowArtifact<T> {
  runId: number
  artifact: T
}

export interface NewestArtifactOutcome<T> {
  success: WorkflowArtifact<T> | null
  /** Failed runs newer than `success` — work that was attempted and did not land. */
  failures: Array<WorkflowArtifact<T>>
  /**
   * The scan hit `maxScan` before finding a success, so older state may exist unread. Without
   * this a truncated scan is indistinguishable from "this track was never published".
   */
  truncated: boolean
}

/**
 * Walks newest-first until it finds an artifact that records a successful operation, collecting
 * the newer failures on the way. A failed run never advanced a track, so it must not be read as
 * track state — but it does need surfacing, and it must not mask the retry.
 *
 * Every download attempt consumes scan budget, including ones that fail to parse: the bound
 * exists to cap dashboard latency, and unparseable artifacts cost the same round trip.
 */
export async function newestSuccessfulArtifact<T>(
  runIds: readonly number[],
  load: (runId: number) => Promise<T>,
  succeeded: (artifact: T) => boolean,
  maxScan = 5,
): Promise<NewestArtifactOutcome<T>> {
  const failures: Array<WorkflowArtifact<T>> = []
  let scanned = 0
  for (const runId of runIds) {
    if (scanned >= maxScan) return { success: null, failures, truncated: true }
    scanned += 1
    let artifact: T
    try {
      artifact = await load(runId)
    } catch (error) {
      if (error instanceof InvalidWorkflowArtifactError) continue
      throw error
    }
    if (succeeded(artifact)) return { success: { runId, artifact }, failures, truncated: false }
    failures.push({ runId, artifact })
  }
  return { success: null, failures, truncated: false }
}

export function parseArtifactRuns(value: unknown, artifactName: string): ArtifactRun[] {
  if (!value || typeof value !== 'object') throw new Error('Artifacts response is invalid')
  const artifacts = (value as { artifacts?: unknown }).artifacts
  if (!Array.isArray(artifacts)) throw new Error('Artifacts response has no artifacts')
  const seen = new Set<number>()
  const runs: ArtifactRun[] = []
  for (const artifact of artifacts as ActionsArtifact[]) {
    if (
      !artifact ||
      typeof artifact !== 'object' ||
      artifact.name !== artifactName ||
      artifact.expired !== false ||
      !Number.isSafeInteger(artifact.workflow_run?.id)
    )
      continue
    const runId = artifact.workflow_run!.id!
    if (seen.has(runId)) continue
    seen.add(runId)
    runs.push({ runId, createdAt: artifact.created_at ?? null })
  }
  return runs.sort((left, right) => right.runId - left.runId)
}

export function parseArtifactRunIds(value: unknown, artifactName: string): number[] {
  return parseArtifactRuns(value, artifactName).map((run) => run.runId)
}

export function parseManifestRunIds(value: unknown): number[] {
  return parseArtifactRunIds(value, 'release-manifest')
}

/**
 * Lists workflow runs that published `artifactName`, newest first. One cheap API call, no
 * artifact downloads — the dashboard counts pending work from these ids alone.
 */
export async function listArtifactRuns(
  repo: string,
  artifactName: string,
  perPage = 30,
): Promise<ArtifactRun[]> {
  const output = await checkedGh(
    ['api', `repos/${repo}/actions/artifacts?name=${artifactName}&per_page=${perPage}`],
    `Cannot list ${artifactName} artifacts`,
  )
  return parseArtifactRuns(JSON.parse(output), artifactName)
}

export async function listInternalCandidates(repo: string): Promise<ReleaseManifest[]> {
  const runs = await listArtifactRuns(repo, 'release-manifest')
  const artifacts = await loadValidWorkflowArtifacts(
    runs.map((run) => run.runId),
    downloadManifest,
  )
  const candidates: ReleaseManifest[] = []
  for (const { artifact: manifest } of artifacts) {
    if (manifest.uploads.phone === 'succeeded' && manifest.uploads.wear === 'succeeded') {
      candidates.push(manifest)
    }
  }
  return candidates.sort((left, right) => right.workflow.runId - left.workflow.runId)
}

export async function listProductionCandidates(repo: string): Promise<ProductionCandidate[]> {
  const runs = await listArtifactRuns(repo, 'promotion-manifest')
  const candidates: ProductionCandidate[] = []
  const openArtifacts = await loadValidWorkflowArtifacts(
    runs.map((run) => run.runId),
    downloadPromotionManifest,
  )
  for (const { runId: openPromotionRunId, artifact: open } of openArtifacts) {
    if (open.phone.status === 'failed' || open.wear.status === 'failed') continue
    const [releaseArtifact] = await loadValidWorkflowArtifacts(
      [open.candidateRunId],
      downloadManifest,
    )
    if (!releaseArtifact) continue
    const manifest = releaseArtifact.artifact
    if (
      open.sourceSha === manifest.sourceSha &&
      open.marketingVersion === manifest.marketingVersion &&
      open.phone.versionCode === manifest.versionCodes.phone &&
      open.wear.versionCode === manifest.versionCodes.wear
    ) {
      candidates.push({ manifest, open, openPromotionRunId })
    }
  }
  return candidates.sort((left, right) => right.openPromotionRunId - left.openPromotionRunId)
}

export function parseTrackConfig(value: unknown): ReleaseTrackConfig {
  const defaults: ReleaseTrackConfig = {
    phoneInternal: 'internal',
    phoneOpen: 'beta',
    phoneProduction: 'production',
    wearInternal: 'wear:internal',
    wearOpen: 'wear:beta',
    wearProduction: 'wear:production',
  }
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray((value as { variables?: unknown }).variables)
  )
    return defaults
  const entries = (value as { variables: Array<{ name?: unknown; value?: unknown }> }).variables
    .filter(
      (entry): entry is { name: string; value: string } =>
        typeof entry.name === 'string' && typeof entry.value === 'string' && entry.value.length > 0,
    )
    .map((entry) => [entry.name, entry.value] as const)
  const variables = Object.fromEntries(entries)
  return {
    phoneInternal: variables.PLAY_PHONE_INTERNAL_TRACK ?? defaults.phoneInternal,
    phoneOpen: variables.PLAY_PHONE_OPEN_TRACK ?? defaults.phoneOpen,
    phoneProduction: variables.PLAY_PHONE_PRODUCTION_TRACK ?? defaults.phoneProduction,
    wearInternal: variables.PLAY_WEAR_INTERNAL_TRACK ?? defaults.wearInternal,
    wearOpen: variables.PLAY_WEAR_OPEN_TRACK ?? defaults.wearOpen,
    wearProduction: variables.PLAY_WEAR_PRODUCTION_TRACK ?? defaults.wearProduction,
  }
}

export async function releaseTrackConfig(repo: string): Promise<ReleaseTrackConfig> {
  const output = await checkedGh(
    ['api', `repos/${repo}/actions/variables?per_page=100`],
    'Cannot read Play track configuration',
  )
  return parseTrackConfig(JSON.parse(output))
}

export async function canonicalNotesPath(
  repo: string,
  marketingVersion: string,
  ref = 'main',
): Promise<string> {
  const path = releaseNotesPath(marketingVersion)
  await checkedGh(
    [
      'api',
      `repos/${repo}/contents/release-notes/${encodeURIComponent(marketingVersion)}.md?ref=${encodeURIComponent(ref)}`,
      '--silent',
    ],
    `Canonical release notes missing at ${path} on ${ref}`,
  )
  return path
}

export interface GitHubRelease {
  tagName: string
  isPrerelease: boolean
}

export function parseReleases(value: unknown): GitHubRelease[] {
  if (!Array.isArray(value)) throw new Error('Release listing is invalid')
  return value
    .filter(
      (entry): entry is { tagName: string; isPrerelease: boolean } =>
        !!entry &&
        typeof entry === 'object' &&
        typeof (entry as { tagName?: unknown }).tagName === 'string' &&
        typeof (entry as { isPrerelease?: unknown }).isPrerelease === 'boolean',
    )
    .map((entry) => ({ tagName: entry.tagName, isPrerelease: entry.isPrerelease }))
}

/** Prerelease tags are cut after internal; they graduate to a full release only at production. */
export async function listPrereleaseTags(repo: string, limit = 20): Promise<string[]> {
  const output = await checkedGh(
    ['release', 'list', '--repo', repo, '--limit', String(limit), '--json', 'tagName,isPrerelease'],
    'Cannot list GitHub releases',
  )
  return parseReleases(JSON.parse(output))
    .filter((release) => release.isPrerelease)
    .map((release) => release.tagName)
}

export async function downloadPromotionManifest(runId: number): Promise<PromotionManifest> {
  const directory = await mkdtemp(join(tmpdir(), 'vescape-promotion-'))
  try {
    await checkedGh(
      ['run', 'download', String(runId), '--name', 'promotion-manifest', '--dir', directory],
      'Cannot download promotion manifest',
    )
    const contents = await readFile(join(directory, 'promotion-manifest.json'), 'utf8')
    return parseWorkflowArtifact(contents, 'Promotion manifest', parsePromotionManifest)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export async function downloadProductionManifest(runId: number): Promise<ProductionManifest> {
  const directory = await mkdtemp(join(tmpdir(), 'vescape-production-'))
  try {
    await checkedGh(
      ['run', 'download', String(runId), '--name', 'production-manifest', '--dir', directory],
      'Cannot download production manifest',
    )
    const contents = await readFile(join(directory, 'production-manifest.json'), 'utf8')
    return parseWorkflowArtifact(contents, 'Production manifest', parseProductionManifest)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export async function retryFailedJobs(runId: number): Promise<void> {
  await checkedGh(retryFailedJobsArgs(runId), 'Cannot retry failed jobs')
}

export function retryFailedJobsArgs(runId: number): string[] {
  if (!Number.isSafeInteger(runId) || runId < 1)
    throw new Error(`Invalid workflow run ID "${runId}"`)
  return ['run', 'rerun', String(runId), '--failed']
}
