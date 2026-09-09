import { parseReleaseManifest } from '../contracts'
import type {
  ProductionManifest,
  PromotionManifest,
  HistoricalReleaseManifest,
  WorkflowRun,
} from '../contracts'
import {
  downloadHistoricalManifest,
  downloadProductionManifest,
  downloadPromotionManifest,
  listArtifactRuns,
  listInternalWorkflowRuns,
  newestSuccessfulArtifact,
  releaseTrackConfig,
  repositoryName,
  verifyGhAuthentication,
  type ArtifactRun,
  type ReleaseTrackConfig,
} from '../github'
import {
  currentMarketingVersion,
  currentPreparedReleaseVersion,
  currentReleaseDraft,
  releaseNotesPath,
  type VersionBump,
} from '../prepare'

export interface TrackRow {
  marketingVersion: string
  phone: number
  wear: number
  detail: string
  runId: number
  age: string | null
  /** Upstream workflow run this track consumed, when it is a promotion. */
  sourceRunId?: number
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
  /**
   * Identifies the exact artifact pair on production. A status refresh must target this, not a
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
  preparedVersion: string | null
  draft: { version: string; bump: VersionBump } | null
  notesPath: string | null
  tracks: ReleaseTrackConfig | null
  internal: TrackRow | null
  open: TrackRow | null
  production: ProductionRow | null
  alerts: string[]
  activeRun: WorkflowRun | null
  failedRun: WorkflowRun | null
  loading: boolean
  error: string | null
  promotableInternalRunId: number | null
  productionEligibleOpenRunId: number | null
  guidance: string | null
}

export function initialReleaseState(): ReleaseState {
  return {
    repo: null,
    devVersion: null,
    preparedVersion: null,
    draft: null,
    notesPath: null,
    tracks: null,
    internal: null,
    open: null,
    production: null,
    alerts: [],
    activeRun: null,
    failedRun: null,
    loading: true,
    error: null,
    promotableInternalRunId: null,
    productionEligibleOpenRunId: null,
    guidance: null,
  }
}

export function internalRow(manifest: HistoricalReleaseManifest, age: string | null): TrackRow {
  return {
    marketingVersion: manifest.marketingVersion,
    phone: manifest.versionCodes.phone,
    wear: manifest.versionCodes.wear,
    detail: 'uploaded',
    runId: manifest.workflow.runId,
    age,
  }
}

export function hasCurrentPromotionProof(manifest: HistoricalReleaseManifest): boolean {
  try {
    parseReleaseManifest(manifest)
    return true
  } catch {
    return false
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
    sourceRunId: manifest.candidateRunId,
  }
}

export function productionRow(
  manifest: ProductionManifest,
  runId: number,
  age: string | null = null,
): ProductionRow {
  return {
    marketingVersion: manifest.marketingVersion,
    phone: manifest.phone.versionCode,
    wear: manifest.wear.versionCode,
    detail: manifest.phone.status,
    runId,
    openPromotionRunId: manifest.openPromotionRunId,
    age,
    sourceRunId: manifest.openPromotionRunId,
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
/**
 * A truncated scan renders the track as if it were never published, which would silently hide
 * the version actually on it. Say so instead of showing an empty row as fact.
 */
export function truncationAlerts(scans: ReadonlyArray<[string, boolean]>): string[] {
  return scans
    .filter(([, truncated]) => truncated)
    .map(
      ([label]) =>
        `${label} history scan found no readable successful release within the scan window; state shown may be incomplete`,
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
    const [devVersion, preparedVersion, draft] = await Promise.all([
      currentMarketingVersion(),
      currentPreparedReleaseVersion(),
      currentReleaseDraft(),
    ])
    emit({
      devVersion,
      preparedVersion,
      draft,
      notesPath: releaseNotesPath(devVersion),
    })

    await verifyGhAuthentication()
    const repo = await repositoryName()
    emit({ repo })

    const [tracks, internalRuns, openRuns, productionRuns, workflowRuns] = await Promise.all([
      releaseTrackConfig(repo),
      listArtifactRuns(repo, 'release-manifest'),
      listArtifactRuns(repo, 'promotion-manifest'),
      listArtifactRuns(repo, 'production-manifest'),
      listInternalWorkflowRuns(repo),
    ])
    emit({
      tracks,
      activeRun: workflowRuns.find((run) => run.status !== 'completed') ?? null,
    })

    const [internal, open, production] = await Promise.all([
      newestSuccessfulArtifact(
        internalRuns.map((run) => run.runId),
        downloadHistoricalManifest,
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
    const internalState = internal.success
      ? internalRow(internal.success.artifact, ageOf(internalRuns, internal.success.runId))
      : null
    const promotableInternalRunId =
      internal.success && hasCurrentPromotionProof(internal.success.artifact)
        ? internal.success.runId
        : null
    let openSource: HistoricalReleaseManifest | null = null
    let openProofUnavailable = false
    if (open.success) {
      try {
        openSource = await downloadHistoricalManifest(open.success.artifact.candidateRunId)
      } catch {
        openProofUnavailable = true
      }
    }
    const productionEligibleOpenRunId =
      open.success && openSource && hasCurrentPromotionProof(openSource) ? open.success.runId : null
    emit({
      internal: internalState,
      open: open.success
        ? openRow(open.success.artifact, open.success.runId, ageOf(openRuns, open.success.runId))
        : null,
      production: productionState,
      failedRun:
        workflowRuns.find(
          (run) =>
            run.status === 'completed' &&
            run.conclusion !== 'success' &&
            run.id > (internalState?.runId ?? 0),
        ) ?? null,
      promotableInternalRunId,
      productionEligibleOpenRunId,
      guidance:
        internalState && internalState.runId !== promotableInternalRunId
          ? `${internalState.marketingVersion} has invalid release metadata; inspect the build details before promoting.`
          : openProofUnavailable && open.success
            ? `Could not verify whether ${open.success.artifact.marketingVersion} is eligible for production.`
            : open.success &&
                open.success.runId !== productionEligibleOpenRunId &&
                open.success.runId !== productionState?.sourceRunId
              ? `${open.success.artifact.marketingVersion} cannot be published because it lacks current promotion proof.`
              : null,
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
