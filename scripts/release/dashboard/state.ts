import type {
  ProductionManifest,
  PromotionManifest,
  ReleaseManifest,
  WorkflowRun,
} from '../contracts'
import {
  downloadManifest,
  downloadProductionManifest,
  downloadPromotionManifest,
  listArtifactRuns,
  listInternalWorkflowRuns,
  listPrereleaseTags,
  newestSuccessfulArtifact,
  releaseTrackConfig,
  repositoryName,
  verifyGhAuthentication,
  type ArtifactRun,
  type ReleaseTrackConfig,
} from '../github'
import { currentMarketingVersion, releaseNotesPath } from '../prepare'

export interface TrackRow {
  marketingVersion: string
  phone: number
  wear: number
  detail: string
  runId: number
  age: string | null
}

/** Compact age for the overview table; the exact timestamp is never the decision-relevant part. */
export function relativeAge(createdAt: string | null, now = Date.now()): string | null {
  if (!createdAt) return null
  const at = Date.parse(createdAt)
  if (!Number.isFinite(at)) return null
  const minutes = Math.max(0, Math.floor((now - at) / 60_000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export interface ProductionRow extends TrackRow {
  rolloutPercentage: number | null
  halted: boolean
  /**
   * Identifies the exact artifact pair on production. Rollout controls must target this, not a
   * marketing version — a rebuild of the same version carries different version codes.
   */
  openPromotionRunId: number
}

/**
 * Everything the dashboard renders. Derived from workflow manifests, so it is the last state the
 * release pipeline recorded — not live Play truth. The `status` production operation is the only
 * path to live Play data, and it needs credentials only the trusted workflow has.
 */
export interface ReleaseState {
  repo: string | null
  devVersion: string | null
  notesPath: string | null
  tracks: ReleaseTrackConfig | null
  internal: TrackRow | null
  open: TrackRow | null
  production: ProductionRow | null
  pendingInternal: number
  pendingOpen: number
  prereleases: string[]
  alerts: string[]
  activeRun: WorkflowRun | null
  loading: boolean
  error: string | null
}

export function initialReleaseState(): ReleaseState {
  return {
    repo: null,
    devVersion: null,
    notesPath: null,
    tracks: null,
    internal: null,
    open: null,
    production: null,
    pendingInternal: 0,
    pendingOpen: 0,
    prereleases: [],
    alerts: [],
    activeRun: null,
    loading: true,
    error: null,
  }
}

export function internalRow(manifest: ReleaseManifest, age: string | null): TrackRow {
  return {
    marketingVersion: manifest.marketingVersion,
    phone: manifest.versionCodes.phone,
    wear: manifest.versionCodes.wear,
    detail: 'uploaded',
    runId: manifest.workflow.runId,
    age,
  }
}

export function openRow(manifest: PromotionManifest, runId: number, age: string | null): TrackRow {
  return {
    marketingVersion: manifest.marketingVersion,
    phone: manifest.phone.versionCode,
    wear: manifest.wear.versionCode,
    detail: manifest.phone.status === 'already-open' ? 'already open' : 'promoted',
    runId,
    age,
  }
}

export function productionRow(
  manifest: ProductionManifest,
  runId: number,
  age: string | null = null,
): ProductionRow {
  const halted = manifest.phone.status === 'halted' || manifest.phone.playStatus === 'halted'
  return {
    marketingVersion: manifest.marketingVersion,
    phone: manifest.phone.versionCode,
    wear: manifest.wear.versionCode,
    detail: manifest.phone.status,
    runId,
    rolloutPercentage: manifest.phone.rolloutPercentage,
    halted,
    openPromotionRunId: manifest.openPromotionRunId,
    age,
  }
}

const ageOf = (runs: readonly ArtifactRun[], runId: number | undefined): string | null =>
  relativeAge(runs.find((run) => run.runId === runId)?.createdAt ?? null)

/**
 * Runs newer than the one a downstream track already consumed — i.e. work waiting to move.
 * Failed runs published a manifest but advanced nothing, so counting them would advertise
 * pending work that no promotion can act on. Only failures inside the scan window are known;
 * an older failure beyond it can still be overcounted.
 */
export function pendingCount(
  runs: readonly ArtifactRun[],
  consumedRunId: number | null,
  failedRunIds: readonly number[] = [],
): number {
  const failed = new Set(failedRunIds)
  return runs.filter(
    (run) => !failed.has(run.runId) && (consumedRunId === null || run.runId > consumedRunId),
  ).length
}

export function unreleasedPrereleases(
  tags: readonly string[],
  productionVersion: string | null,
): string[] {
  return tags.filter((tag) => tag !== `v${productionVersion}`)
}

/**
 * A truncated scan renders the track as if it were never published, which would silently hide
 * its rollout controls. Say so instead of showing an empty row as fact.
 */
export function truncationAlerts(scans: ReadonlyArray<[string, boolean]>): string[] {
  return scans
    .filter(([, truncated]) => truncated)
    .map(
      ([label]) =>
        `${label} history is all failures within the scan window; state shown may be incomplete`,
    )
}

export type ReleaseStatePatch = Partial<ReleaseState>

/**
 * Loads in tiers so the dashboard paints immediately: local git first, then one cheap API call per
 * artifact listing, then the newest manifest per track. Only three artifact downloads happen —
 * pending counts come from the listings, which are ids only.
 */
export async function loadReleaseState(emit: (patch: ReleaseStatePatch) => void): Promise<void> {
  try {
    const devVersion = await currentMarketingVersion()
    emit({
      devVersion,
      notesPath: releaseNotesPath(devVersion),
    })

    await verifyGhAuthentication()
    const repo = await repositoryName()
    emit({ repo })

    const [tracks, internalRuns, openRuns, productionRuns, prereleases, workflowRuns] =
      await Promise.all([
        releaseTrackConfig(repo),
        listArtifactRuns(repo, 'release-manifest'),
        listArtifactRuns(repo, 'promotion-manifest'),
        listArtifactRuns(repo, 'production-manifest'),
        listPrereleaseTags(repo),
        listInternalWorkflowRuns(repo),
      ])
    emit({
      tracks,
      prereleases,
      activeRun: workflowRuns.find((run) => run.status !== 'completed') ?? null,
    })

    const [internal, open, production] = await Promise.all([
      newestSuccessfulArtifact(
        internalRuns.map((run) => run.runId),
        downloadManifest,
        (manifest) =>
          manifest.uploads.phone === 'succeeded' && manifest.uploads.wear === 'succeeded',
      ),
      newestSuccessfulArtifact(
        openRuns.map((run) => run.runId),
        downloadPromotionManifest,
        (manifest) => manifest.phone.status !== 'failed' && manifest.wear.status !== 'failed',
      ),
      newestSuccessfulArtifact(
        productionRuns.map((run) => run.runId),
        downloadProductionManifest,
        (manifest) => manifest.phone.status !== 'failed' && manifest.wear.status !== 'failed',
      ),
    ])

    const productionState = production.success
      ? productionRow(
          production.success.artifact,
          production.success.runId,
          ageOf(productionRuns, production.success.runId),
        )
      : null
    emit({
      internal: internal.success
        ? internalRow(internal.success.artifact, ageOf(internalRuns, internal.success.runId))
        : null,
      open: open.success
        ? openRow(open.success.artifact, open.success.runId, ageOf(openRuns, open.success.runId))
        : null,
      production: productionState,
      pendingInternal: pendingCount(
        internalRuns,
        open.success?.artifact.candidateRunId ?? null,
        internal.failures.map((failure) => failure.runId),
      ),
      pendingOpen: pendingCount(
        openRuns,
        production.success?.artifact.openPromotionRunId ?? null,
        open.failures.map((failure) => failure.runId),
      ),
      prereleases: unreleasedPrereleases(prereleases, productionState?.marketingVersion ?? null),
      alerts: [
        ...internal.failures.map(
          (failure) =>
            `Internal build ${failure.artifact.marketingVersion} failed (run ${failure.runId})`,
        ),
        ...open.failures.map(
          (failure) =>
            `Open promotion of ${failure.artifact.marketingVersion} failed (run ${failure.runId})`,
        ),
        ...production.failures.map(
          (failure) =>
            `Production ${failure.artifact.operation} of ${failure.artifact.marketingVersion} failed (run ${failure.runId})`,
        ),
        ...truncationAlerts([
          ['Internal', internal.truncated],
          ['Open', open.truncated],
          ['Production', production.truncated],
        ]),
      ],
      loading: false,
    })
  } catch (caught) {
    emit({ loading: false, error: caught instanceof Error ? caught.message : String(caught) })
  }
}
