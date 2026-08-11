export type UploadStatus = 'succeeded' | 'failed'

export interface ArtifactIdentity {
  name: string
  sha256: string
  signingCertificateSha256: string
}

export interface ReleaseManifest {
  schemaVersion: 1
  requestId: string
  sourceSha: string
  marketingVersion: string
  versionCodes: {
    phone: number
    wear: number
  }
  workflow: {
    runId: number
    runUrl: string
    runAttempt: number
  }
  artifacts: {
    phone: ArtifactIdentity
    wear: ArtifactIdentity
  }
  uploads: {
    phone: UploadStatus
    wear: UploadStatus
  }
}

export interface WorkflowRun {
  id: number
  html_url: string
  display_title: string
  status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending'
  conclusion: string | null
  head_sha?: string
  run_number?: number
  run_attempt?: number
  created_at?: string
  run_started_at?: string | null
  updated_at?: string
}

export interface WorkflowStep {
  name: string
  status: string
  conclusion: string | null
}

export interface WorkflowJob {
  id: number
  name: string
  status: string
  conclusion: string | null
  started_at: string | null
  completed_at: string | null
  steps: WorkflowStep[]
}

export type PromotionArtifactStatus = 'promoted' | 'already-open' | 'failed'

export interface PromotionArtifactResult {
  versionCode: number
  sourceTrack: string
  targetTrack: string
  status: PromotionArtifactStatus
}

export interface PromotionManifest {
  schemaVersion: 1
  requestId: string
  candidateRunId: number
  sourceSha: string
  marketingVersion: string
  phone: PromotionArtifactResult
  wear: PromotionArtifactResult
}

export type ProductionOperation = 'promote' | 'status' | 'halt' | 'resume' | 'advance'
export type ProductionArtifactStatus =
  | 'promoted'
  | 'already-production'
  | 'active'
  | 'halted'
  | 'resumed'
  | 'advanced'
  | 'failed'

export interface ProductionArtifactResult {
  versionCode: number
  sourceTrack: string
  targetTrack: string
  status: ProductionArtifactStatus
  playStatus: string | null
  rolloutPercentage: number | null
}

export interface ProductionManifest {
  schemaVersion: 1
  requestId: string
  openPromotionRunId: number
  sourceSha: string
  marketingVersion: string
  operation: ProductionOperation
  requestedRolloutPercentage: number | null
  phone: ProductionArtifactResult
  wear: ProductionArtifactResult
  githubRelease: 'released' | 'already-released' | 'skipped' | 'failed'
}

export function parseReleaseManifest(value: unknown): ReleaseManifest {
  if (!value || typeof value !== 'object') throw new Error('Release manifest is not an object')
  const manifest = value as Partial<ReleaseManifest>
  if (
    manifest.schemaVersion !== 1 ||
    typeof manifest.requestId !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(manifest.requestId) ||
    typeof manifest.sourceSha !== 'string' ||
    !/^[0-9a-f]{40}$/i.test(manifest.sourceSha) ||
    typeof manifest.marketingVersion !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.marketingVersion) ||
    !manifest.versionCodes ||
    typeof manifest.versionCodes.phone !== 'number' ||
    typeof manifest.versionCodes.wear !== 'number' ||
    !manifest.workflow ||
    typeof manifest.workflow.runId !== 'number' ||
    typeof manifest.workflow.runUrl !== 'string' ||
    !manifest.artifacts?.phone ||
    !manifest.artifacts.wear ||
    !manifest.uploads ||
    !['succeeded', 'failed'].includes(manifest.uploads.phone ?? '') ||
    !['succeeded', 'failed'].includes(manifest.uploads.wear ?? '')
  ) {
    throw new Error('Release manifest has an invalid shape')
  }
  return manifest as ReleaseManifest
}

export type ReleaseOutcome =
  | { kind: 'success' }
  | { kind: 'failure' }
  | { kind: 'partial'; succeeded: 'phone' | 'wear'; failed: 'phone' | 'wear' }

export function releaseOutcome(manifest: ReleaseManifest): ReleaseOutcome {
  const { phone, wear } = manifest.uploads
  if (phone === 'succeeded' && wear === 'succeeded') return { kind: 'success' }
  if (phone === wear) return { kind: 'failure' }
  return phone === 'succeeded'
    ? { kind: 'partial', succeeded: 'phone', failed: 'wear' }
    : { kind: 'partial', succeeded: 'wear', failed: 'phone' }
}

export function parsePromotionManifest(value: unknown): PromotionManifest {
  if (!value || typeof value !== 'object') throw new Error('Promotion manifest is not an object')
  const manifest = value as Partial<PromotionManifest>
  const validArtifact = (artifact: PromotionArtifactResult | undefined) =>
    artifact &&
    Number.isSafeInteger(artifact.versionCode) &&
    artifact.versionCode > 0 &&
    typeof artifact.sourceTrack === 'string' &&
    typeof artifact.targetTrack === 'string' &&
    ['promoted', 'already-open', 'failed'].includes(artifact.status)
  if (
    manifest.schemaVersion !== 1 ||
    typeof manifest.requestId !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(manifest.requestId) ||
    !Number.isSafeInteger(manifest.candidateRunId) ||
    manifest.candidateRunId! < 1 ||
    typeof manifest.sourceSha !== 'string' ||
    !/^[0-9a-f]{40}$/i.test(manifest.sourceSha) ||
    typeof manifest.marketingVersion !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.marketingVersion) ||
    !validArtifact(manifest.phone) ||
    !validArtifact(manifest.wear)
  ) {
    throw new Error('Promotion manifest has an invalid shape')
  }
  return manifest as PromotionManifest
}

export function promotionSummary(manifest: PromotionManifest): string {
  const render = (name: string, artifact: PromotionArtifactResult) =>
    `${name} ${artifact.versionCode}: ${artifact.status}`
  return `${render('phone', manifest.phone)} · ${render('Wear', manifest.wear)}`
}

export function parseProductionManifest(value: unknown): ProductionManifest {
  if (!value || typeof value !== 'object') throw new Error('Production manifest is not an object')
  const manifest = value as Partial<ProductionManifest>
  const operations: ProductionOperation[] = ['promote', 'status', 'halt', 'resume', 'advance']
  const statuses: ProductionArtifactStatus[] = [
    'promoted',
    'already-production',
    'active',
    'halted',
    'resumed',
    'advanced',
    'failed',
  ]
  const validPercentage = (value: unknown) =>
    value === null || (typeof value === 'number' && value > 0 && value <= 100)
  const validArtifact = (artifact: ProductionArtifactResult | undefined) =>
    artifact &&
    Number.isSafeInteger(artifact.versionCode) &&
    artifact.versionCode > 0 &&
    typeof artifact.sourceTrack === 'string' &&
    artifact.sourceTrack.length > 0 &&
    typeof artifact.targetTrack === 'string' &&
    artifact.targetTrack.length > 0 &&
    statuses.includes(artifact.status) &&
    (artifact.playStatus === null || typeof artifact.playStatus === 'string') &&
    validPercentage(artifact.rolloutPercentage)
  const operationNeedsPercentage =
    manifest.operation === 'promote' || manifest.operation === 'advance'
  if (
    manifest.schemaVersion !== 1 ||
    typeof manifest.requestId !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(manifest.requestId) ||
    !Number.isSafeInteger(manifest.openPromotionRunId) ||
    manifest.openPromotionRunId! < 1 ||
    typeof manifest.sourceSha !== 'string' ||
    !/^[0-9a-f]{40}$/i.test(manifest.sourceSha) ||
    typeof manifest.marketingVersion !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.marketingVersion) ||
    !operations.includes(manifest.operation as ProductionOperation) ||
    !validPercentage(manifest.requestedRolloutPercentage) ||
    operationNeedsPercentage !== (typeof manifest.requestedRolloutPercentage === 'number') ||
    !validArtifact(manifest.phone) ||
    !validArtifact(manifest.wear) ||
    !['released', 'already-released', 'skipped', 'failed'].includes(manifest.githubRelease ?? '')
  ) {
    throw new Error('Production manifest has an invalid shape')
  }
  return manifest as ProductionManifest
}

export function productionSummary(manifest: ProductionManifest): string {
  const render = (name: string, artifact: ProductionArtifactResult) => {
    const rollout = artifact.rolloutPercentage === null ? '' : ` @ ${artifact.rolloutPercentage}%`
    return `${name} ${artifact.versionCode}: ${artifact.status}${rollout}`
  }
  return `${render('phone', manifest.phone)} · ${render('Wear', manifest.wear)} · GitHub ${manifest.githubRelease}`
}
