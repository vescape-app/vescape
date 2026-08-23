import React, { useEffect, useState } from 'react'
import { Box, render, Text, useApp, useInput } from 'ink'
import type { ProductionOperation, ReleaseManifest, WorkflowJob, WorkflowRun } from './contracts'
import { productionSummary, promotionSummary, releaseOutcome } from './contracts'
import {
  canonicalNotesPath,
  createDispatchPayload,
  createPromotionDispatchPayload,
  createProductionDispatchPayload,
  describeSourceRef,
  type SourceRefPreview,
  dispatchInternalBuild,
  dispatchIosInternalBuild,
  dispatchOpenPromotion,
  dispatchProduction,
  downloadManifest,
  downloadPromotionManifest,
  downloadProductionManifest,
  failedWorkflowJobs,
  findDispatchedIosRun,
  findDispatchedRun,
  findPromotionRun,
  findProductionRun,
  getWorkflowRun,
  getWorkflowJobs,
  listInternalCandidates,
  listInternalWorkflowRuns,
  listProductionCandidates,
  marketingVersion,
  type ReleaseTrackConfig,
  type ProductionCandidate,
  releaseTrackConfig,
  repositoryDefaultBranch,
  repositoryName,
  resolveSourceSha,
  retryFailedJobs,
  verifyGhAuthentication,
  verifyRemoteCommit,
} from './github'
import { publishGithubRelease } from './githubRelease'
import { internalReleaseProgress, workflowElapsed } from './progress'
import {
  bumpMarketingVersion,
  currentMarketingVersion,
  type VersionBump,
  verifyReleasePreparationReady,
} from './prepare'
import { Dashboard } from './dashboard/Dashboard'
import { availableActions, defaultActionIndex, type ActionId } from './dashboard/actions'
import { initialReleaseState, loadReleaseState, type ReleaseState } from './dashboard/state'
import { Confirm, Hint, isEnter, Menu, Rule } from './ui'
import {
  productionFields,
  promotionFields,
  type Plan,
  type ProductionPlan,
  type PromotionPlan,
} from './flows/plans'

type Phase =
  | 'dashboard'
  | 'version-bump'
  | 'version-confirm'
  | 'build-source'
  | 'internal-runs'
  | 'checking'
  | 'candidate'
  | 'production-candidate'
  | 'production-percentage'
  | 'confirm'
  | 'promote-confirm'
  | 'production-confirm'
  | 'dispatching'
  | 'waiting'
  | 'running'
  | 'complete'
  | 'error'

const versionBumps: ReadonlyArray<{ bump: VersionBump; label: string }> = [
  { bump: 'major', label: 'Major' },
  { bump: 'minor', label: 'Minor' },
  { bump: 'patch', label: 'Patch' },
]

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const CONFIRM_INDEX = 0
const CANCEL_INDEX = 1

export interface ReleaseCliOptions {
  initialPhase?: 'dashboard' | 'build-source'
  initialSourceRef?: string
}

export type ReleaseCliResult = { kind: 'exit' } | { kind: 'prepare'; bump: VersionBump }

interface AppProps extends ReleaseCliOptions {
  finish: (result: ReleaseCliResult) => void
}

function App({ finish, initialPhase = 'dashboard', initialSourceRef }: AppProps) {
  const { exit } = useApp()
  const initialRef =
    initialSourceRef ?? process.argv.find((value) => value.startsWith('--sha='))?.slice(6) ?? 'HEAD'
  const [sourceRef, setSourceRef] = useState(initialRef)
  // The prefilled ref is a suggestion: the first keystroke replaces it instead of appending to it.
  const [sourceRefEdited, setSourceRefEdited] = useState(false)
  const [sourcePreview, setSourcePreview] = useState<SourceRefPreview | null>(null)
  const [sourceChecking, setSourceChecking] = useState(false)
  const [phase, setPhase] = useState<Phase>(initialPhase)
  const [status, setStatus] = useState('')
  const [releaseState, setReleaseState] = useState<ReleaseState>(initialReleaseState)
  const [index, setIndex] = useState(0)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [promotionPlan, setPromotionPlan] = useState<PromotionPlan | null>(null)
  const [productionPlan, setProductionPlan] = useState<ProductionPlan | null>(null)
  const [candidates, setCandidates] = useState<ReleaseManifest[]>([])
  const [productionCandidates, setProductionCandidates] = useState<ProductionCandidate[]>([])
  const [internalRuns, setInternalRuns] = useState<WorkflowRun[]>([])
  const [internalRunsRepo, setInternalRunsRepo] = useState('')
  const [workflowJobs, setWorkflowJobs] = useState<WorkflowJob[]>([])
  const [watchedRun, setWatchedRun] = useState<WorkflowRun | null>(null)
  const [clock, setClock] = useState(Date.now())
  const [currentVersion, setCurrentVersion] = useState('')
  const [bumpIndex, setBumpIndex] = useState(1)
  const [rolloutInput, setRolloutInput] = useState('10')
  const [run, setRun] = useState<{ id: number; url: string } | null>(null)
  const [iosRun, setIosRun] = useState<{ id: number; url: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retryRunId, setRetryRunId] = useState<number | null>(null)

  const goto = (next: Phase, nextIndex = 0) => {
    setIndex(nextIndex)
    setPhase(next)
  }

  const fail = (caught: unknown) => {
    setError(caught instanceof Error ? caught.message : String(caught))
    goto('error')
  }

  const gotoBuildSource = () => {
    setSourceRefEdited(false)
    goto('build-source')
  }

  const loadDashboard = () => {
    setReleaseState(initialReleaseState())
    setStatus('')
    goto('dashboard')
    void loadReleaseState((patch) => setReleaseState((previous) => ({ ...previous, ...patch })))
  }

  useEffect(() => {
    if (initialPhase === 'dashboard') loadDashboard()
    // Preparation already fixed the commit to build; asking for it again answers nothing.
    else if (initialSourceRef) void prepare()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (phase !== 'build-source') return
    let active = true
    setSourceChecking(true)
    const timer = setTimeout(() => {
      void describeSourceRef(sourceRef).then((preview) => {
        if (!active) return
        setSourcePreview(preview)
        setSourceChecking(false)
      })
    }, 120)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [phase, sourceRef])

  const actions = availableActions(releaseState)

  const activeRunId = releaseState.activeRun?.id ?? null
  useEffect(() => {
    if (phase === 'dashboard') setIndex(defaultActionIndex(actions, releaseState))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRunId])

  const prepareVersionMenu = async () => {
    goto('checking')
    setStatus('Checking branch and working tree…')
    try {
      await verifyReleasePreparationReady()
      setCurrentVersion(await currentMarketingVersion())
      setStatus('')
      goto('version-bump', 1)
    } catch (caught) {
      fail(caught)
    }
  }

  const prepare = async () => {
    goto('checking')
    setStatus('Checking gh auth and source commit…')
    try {
      await verifyGhAuthentication()
      const repo = await repositoryName()
      const workflowRef = await repositoryDefaultBranch(repo)
      const sourceSha = await resolveSourceSha(sourceRef)
      await verifyRemoteCommit(repo, sourceSha)
      const version = await marketingVersion(repo, sourceSha)
      setPlan({
        repo,
        workflowRef,
        sourceSha,
        marketingVersion: version,
        requestId: crypto.randomUUID(),
      })
      setStatus('')
      goto('confirm')
    } catch (caught) {
      fail(caught)
    }
  }

  const preparePromotion = async () => {
    goto('checking')
    setStatus('Loading successful internal manifests…')
    try {
      await verifyGhAuthentication()
      const repo = await repositoryName()
      const [available, tracks, workflowRef] = await Promise.all([
        listInternalCandidates(repo),
        releaseTrackConfig(repo),
        repositoryDefaultBranch(repo),
      ])
      if (available.length === 0) throw new Error('No successful internal release manifests found')
      setCandidates(available)
      setPromotionPlan({
        repo,
        workflowRef,
        candidate: available[0],
        requestId: crypto.randomUUID(),
        notesPath: '',
        tracks,
      })
      setStatus('')
      goto('candidate')
    } catch (caught) {
      fail(caught)
    }
  }

  const confirmPromotionCandidate = async (candidateIndex: number) => {
    const candidate = candidates[candidateIndex]
    if (!promotionPlan || !candidate) return
    goto('checking')
    setStatus(`Checking canonical notes for ${candidate.marketingVersion}…`)
    try {
      const notesPath = await canonicalNotesPath(promotionPlan.repo, candidate.marketingVersion)
      setPromotionPlan({ ...promotionPlan, candidate, notesPath })
      setStatus('')
      goto('promote-confirm')
    } catch (caught) {
      fail(caught)
    }
  }

  const applyProductionCandidate = async (
    basePlan: ProductionPlan,
    candidate: ProductionCandidate,
  ) => {
    setStatus(`Checking canonical notes for ${candidate.manifest.marketingVersion}…`)
    const notesPath = await canonicalNotesPath(
      basePlan.repo,
      candidate.manifest.marketingVersion,
      candidate.manifest.sourceSha,
    )
    const next = { ...basePlan, candidate, notesPath }
    setProductionPlan(next)
    setStatus('')
    if (next.operation === 'promote' || next.operation === 'advance') {
      setRolloutInput(String(next.rolloutPercentage ?? 10))
      goto('production-percentage')
    } else {
      goto('production-confirm', CANCEL_INDEX)
    }
  }

  /**
   * Rollout controls act on whatever is already on production, so only `promote` needs the
   * candidate picker; the rest resolve the candidate from the recorded production version.
   */
  const prepareProduction = async (operation: ProductionOperation) => {
    goto('checking')
    setStatus('Loading releases proven active on open testing…')
    try {
      await verifyGhAuthentication()
      const repo = await repositoryName()
      const [available, tracks, workflowRef] = await Promise.all([
        listProductionCandidates(repo),
        releaseTrackConfig(repo),
        repositoryDefaultBranch(repo),
      ])
      if (available.length === 0) throw new Error('No exact open-tested release manifests found')
      const basePlan: ProductionPlan = {
        repo,
        workflowRef,
        candidate: available[0],
        requestId: crypto.randomUUID(),
        notesPath: '',
        tracks,
        operation,
        rolloutPercentage: 10,
      }
      if (operation === 'promote') {
        setProductionCandidates(available)
        setProductionPlan(basePlan)
        setStatus('')
        goto('production-candidate')
        return
      }
      const live = releaseState.production
      const target = live
        ? available.find((candidate) => candidate.openPromotionRunId === live.openPromotionRunId)
        : undefined
      if (!target)
        throw new Error(
          live
            ? `No open-tested manifest matches the exact artifacts on production (open promotion run ${live.openPromotionRunId}); cannot target the live rollout`
            : 'Nothing is recorded on production; cannot target a live rollout',
        )
      await applyProductionCandidate(basePlan, target)
    } catch (caught) {
      fail(caught)
    }
  }

  const confirmProductionCandidate = async (candidateIndex: number) => {
    const candidate = productionCandidates[candidateIndex]
    if (!productionPlan || !candidate) return
    goto('checking')
    try {
      await applyProductionCandidate(productionPlan, candidate)
    } catch (caught) {
      fail(caught)
    }
  }

  const confirmProductionPercentage = () => {
    if (!productionPlan) return
    const percentage = Number(rolloutInput)
    if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
      setError('Rollout percentage must be greater than 0 and at most 100')
      goto('error')
      return
    }
    setProductionPlan({ ...productionPlan, rolloutPercentage: percentage })
    goto('production-confirm', CANCEL_INDEX)
  }

  const prepareInternalRuns = async () => {
    goto('checking')
    setStatus('Finding recent Internal releases…')
    try {
      await verifyGhAuthentication()
      const repo = await repositoryName()
      const available = await listInternalWorkflowRuns(repo)
      if (available.length === 0) throw new Error('No resumable Internal release runs found')
      setInternalRunsRepo(repo)
      setInternalRuns(available)
      setStatus('')
      goto('internal-runs')
    } catch (caught) {
      fail(caught)
    }
  }

  const finishInternalRun = async (repo: string, workflowRun: WorkflowRun) => {
    setStatus('Reading release manifest…')
    let manifest
    try {
      manifest = await downloadManifest(workflowRun.id)
    } catch (manifestError) {
      if (workflowRun.conclusion !== 'success') {
        const failedJobs = await failedWorkflowJobs(repo, workflowRun.id)
        throw new Error(
          `Workflow failed${failedJobs.length > 0 ? ` in ${failedJobs.join(', ')}` : ''}. ${workflowRun.html_url}`,
        )
      }
      throw manifestError
    }
    const outcome = releaseOutcome(manifest)
    if (outcome.kind === 'success') {
      setStatus('Internal ready')
    } else if (outcome.kind === 'partial') {
      setStatus(`${outcome.succeeded} uploaded; ${outcome.failed} failed`)
      setRetryRunId(workflowRun.id)
    } else {
      setStatus('Both internal uploads failed')
      setRetryRunId(workflowRun.id)
    }
    goto('complete')
  }

  const watchInternalRun = async (repo: string, initialRun: WorkflowRun) => {
    let workflowRun = initialRun
    setClock(Date.now())
    setRun({ id: workflowRun.id, url: workflowRun.html_url })
    setWatchedRun(workflowRun)
    setWorkflowJobs(await getWorkflowJobs(repo, workflowRun.id))
    goto('running')
    while (workflowRun.status !== 'completed') {
      setStatus(`Internal release ${workflowRun.status.replace('_', ' ')}…`)
      await sleep(10_000)
      const [nextRun, jobs] = await Promise.all([
        getWorkflowRun(repo, workflowRun.id),
        getWorkflowJobs(repo, workflowRun.id),
      ])
      workflowRun = nextRun
      setWatchedRun(nextRun)
      setWorkflowJobs(jobs)
    }
    await finishInternalRun(repo, workflowRun)
  }

  const resumeInternalRun = async (runIndex: number) => {
    const selected = internalRuns[runIndex]
    if (!selected || !internalRunsRepo) return
    goto('checking')
    setStatus('Loading live workflow progress…')
    try {
      const current = await getWorkflowRun(internalRunsRepo, selected.id)
      await watchInternalRun(internalRunsRepo, current)
    } catch (caught) {
      fail(caught)
    }
  }

  const dispatch = async (confirmedPlan: Plan) => {
    goto('dispatching')
    setStatus(`Publishing the v${confirmedPlan.marketingVersion} GitHub release…`)
    try {
      const githubRelease = await publishGithubRelease(confirmedPlan.repo, confirmedPlan)
      setStatus(
        `GitHub release ${githubRelease} · dispatching Android and iOS workflows from ${confirmedPlan.workflowRef}…`,
      )
      const payload = createDispatchPayload(
        confirmedPlan.sourceSha,
        confirmedPlan.requestId,
        confirmedPlan.workflowRef,
      )
      setIosRun(null)
      await dispatchInternalBuild(confirmedPlan.repo, payload)
      await dispatchIosInternalBuild(confirmedPlan.repo, payload)
      goto('waiting')
      setStatus('Waiting for structured workflow runs…')
      let workflowRun = null
      let iosWorkflowRun = null
      for (let attempt = 0; attempt < 30 && !(workflowRun && iosWorkflowRun); attempt += 1) {
        if (!workflowRun)
          workflowRun = await findDispatchedRun(confirmedPlan.repo, confirmedPlan.requestId)
        if (!iosWorkflowRun)
          iosWorkflowRun = await findDispatchedIosRun(confirmedPlan.repo, confirmedPlan.requestId)
        if (!(workflowRun && iosWorkflowRun)) await sleep(2_000)
      }
      if (iosWorkflowRun) setIosRun({ id: iosWorkflowRun.id, url: iosWorkflowRun.html_url })
      if (!workflowRun) throw new Error('Dispatch succeeded, but its workflow run was not found')
      await watchInternalRun(confirmedPlan.repo, workflowRun)
    } catch (caught) {
      fail(caught)
    }
  }

  const promote = async (confirmedPlan: PromotionPlan) => {
    goto('dispatching')
    setStatus(`Dispatching trusted open-promotion workflow from ${confirmedPlan.workflowRef}…`)
    try {
      await dispatchOpenPromotion(
        confirmedPlan.repo,
        createPromotionDispatchPayload(
          confirmedPlan.candidate,
          confirmedPlan.requestId,
          confirmedPlan.workflowRef,
        ),
      )
      goto('waiting')
      setStatus('Waiting for structured promotion run…')
      let workflowRun = null
      for (let attempt = 0; attempt < 30 && !workflowRun; attempt += 1) {
        workflowRun = await findPromotionRun(confirmedPlan.repo, confirmedPlan.requestId)
        if (!workflowRun) await sleep(2_000)
      }
      if (!workflowRun) throw new Error('Dispatch succeeded, but its promotion run was not found')
      setRun({ id: workflowRun.id, url: workflowRun.html_url })
      goto('running')
      while (workflowRun.status !== 'completed') {
        setStatus(`Promotion ${workflowRun.status.replace('_', ' ')}…`)
        await sleep(10_000)
        workflowRun = await getWorkflowRun(confirmedPlan.repo, workflowRun.id)
      }
      setStatus('Reading per-form-factor promotion result…')
      const manifest = await downloadPromotionManifest(workflowRun.id)
      setStatus(promotionSummary(manifest))
      if (manifest.phone.status === 'failed' || manifest.wear.status === 'failed') {
        setRetryRunId(workflowRun.id)
      }
      goto('complete')
    } catch (caught) {
      fail(caught)
    }
  }

  const runProduction = async (confirmedPlan: ProductionPlan) => {
    goto('dispatching')
    setStatus(
      `Dispatching trusted production ${confirmedPlan.operation} workflow from ${confirmedPlan.workflowRef}…`,
    )
    try {
      await dispatchProduction(
        confirmedPlan.repo,
        createProductionDispatchPayload(
          confirmedPlan.candidate,
          confirmedPlan.operation,
          confirmedPlan.requestId,
          confirmedPlan.operation === 'promote' || confirmedPlan.operation === 'advance'
            ? confirmedPlan.rolloutPercentage
            : undefined,
          confirmedPlan.workflowRef,
        ),
      )
      goto('waiting')
      setStatus('Waiting for structured production run…')
      let workflowRun = null
      for (let attempt = 0; attempt < 30 && !workflowRun; attempt += 1) {
        workflowRun = await findProductionRun(confirmedPlan.repo, confirmedPlan.requestId)
        if (!workflowRun) await sleep(2_000)
      }
      if (!workflowRun) throw new Error('Dispatch succeeded, but its production run was not found')
      setRun({ id: workflowRun.id, url: workflowRun.html_url })
      goto('running')
      while (workflowRun.status !== 'completed') {
        setStatus(`Production ${workflowRun.status.replace('_', ' ')}…`)
        await sleep(10_000)
        workflowRun = await getWorkflowRun(confirmedPlan.repo, workflowRun.id)
      }
      setStatus('Reading exact production rollout state…')
      const manifest = await downloadProductionManifest(workflowRun.id)
      setStatus(productionSummary(manifest))
      if (
        manifest.phone.status === 'failed' ||
        manifest.wear.status === 'failed' ||
        manifest.githubRelease === 'failed'
      ) {
        setRetryRunId(workflowRun.id)
      }
      goto('complete')
    } catch (caught) {
      fail(caught)
    }
  }

  const startAction = (id: ActionId) => {
    if (id === 'watch') void prepareInternalRuns()
    else if (id === 'promote-open') void preparePromotion()
    else if (id === 'promote-production') void prepareProduction('promote')
    else if (id === 'advance') void prepareProduction('advance')
    else if (id === 'halt') void prepareProduction('halt')
    else if (id === 'resume') void prepareProduction('resume')
    else if (id === 'status') void prepareProduction('status')
    else if (id === 'build') gotoBuildSource()
    else if (id === 'prepare') void prepareVersionMenu()
    else loadDashboard()
  }

  const moveIndex = (key: { upArrow: boolean; downArrow: boolean }, length: number) => {
    if (length === 0) return
    if (key.upArrow) setIndex((value) => (value - 1 + length) % length)
    else if (key.downArrow) setIndex((value) => (value + 1) % length)
  }

  useInput((input, key) => {
    const enter = isEnter(input, key)
    if (phase === 'dashboard') {
      if (releaseState.loading && !releaseState.error) return
      moveIndex(key, actions.length)
      if (enter && actions[index]) startAction(actions[index].id)
      else if (key.escape) {
        finish({ kind: 'exit' })
        exit()
      }
      return
    }
    if (phase === 'version-bump') {
      moveIndex(key, versionBumps.length)
      if (enter) {
        setBumpIndex(index)
        goto('version-confirm')
      } else if (key.escape) loadDashboard()
      return
    }
    if (phase === 'version-confirm') {
      moveIndex(key, 2)
      if (enter) {
        if (index === CONFIRM_INDEX) {
          finish({ kind: 'prepare', bump: versionBumps[bumpIndex].bump })
          exit()
        } else goto('version-bump', bumpIndex)
      } else if (key.escape) goto('version-bump', bumpIndex)
      return
    }
    if (phase === 'build-source') {
      if (enter) {
        if (sourcePreview) void prepare()
      } else if (key.escape) loadDashboard()
      else if (key.backspace || key.delete) {
        setSourceRefEdited(true)
        setSourceRef((value) => (sourceRefEdited ? value.slice(0, -1) : ''))
      } else if (input && !key.ctrl && !key.meta) {
        // Keep other buffered control characters out of the source ref.
        const typed = input.replace(/[^\w./-]/g, '')
        if (typed) {
          setSourceRefEdited(true)
          setSourceRef((value) => (sourceRefEdited ? value + typed : typed))
        }
      }
      return
    }
    if (phase === 'candidate') {
      moveIndex(key, candidates.length)
      if (enter) void confirmPromotionCandidate(index)
      else if (key.escape) loadDashboard()
      return
    }
    if (phase === 'internal-runs') {
      moveIndex(key, internalRuns.length)
      if (enter) void resumeInternalRun(index)
      else if (key.escape) loadDashboard()
      return
    }
    if (phase === 'production-candidate') {
      moveIndex(key, productionCandidates.length)
      if (enter) void confirmProductionCandidate(index)
      else if (key.escape) loadDashboard()
      return
    }
    if (phase === 'production-percentage') {
      if (enter) confirmProductionPercentage()
      else if (key.escape) loadDashboard()
      else if (key.backspace || key.delete) setRolloutInput((value) => value.slice(0, -1))
      else if (/^[0-9.]$/.test(input)) setRolloutInput((value) => value + input)
      return
    }
    if (phase === 'confirm') {
      moveIndex(key, 2)
      if (enter) {
        if (index === CONFIRM_INDEX && plan) void dispatch(plan)
        else gotoBuildSource()
      } else if (key.escape) gotoBuildSource()
      return
    }
    if (phase === 'promote-confirm') {
      moveIndex(key, 2)
      if (enter) {
        if (index === CONFIRM_INDEX && promotionPlan) void promote(promotionPlan)
        else goto('candidate')
      } else if (key.escape) goto('candidate')
      return
    }
    if (phase === 'production-confirm') {
      moveIndex(key, 2)
      if (enter) {
        if (index === CONFIRM_INDEX && productionPlan) void runProduction(productionPlan)
        else loadDashboard()
      } else if (key.escape) loadDashboard()
      return
    }
    if (phase === 'complete' && retryRunId && input.toLowerCase() === 'r') {
      setRetryRunId(null)
      setWatchedRun(null)
      goto('running')
      setStatus('Retrying failed jobs only…')
      void retryFailedJobs(retryRunId)
        .then(() => {
          setStatus(`Retry requested for workflow ${retryRunId}. Re-run this CLI to watch it.`)
          goto('complete')
        })
        .catch(fail)
      return
    }
    if (phase === 'complete' || phase === 'error') {
      if (enter || key.escape) loadDashboard()
      else if (input === 'q') {
        finish({ kind: 'exit' })
        exit()
      }
    }
  })

  useEffect(() => {
    if (phase !== 'running' || !watchedRun) return
    const timer = setInterval(() => setClock(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [phase, watchedRun])

  const progress = watchedRun ? internalReleaseProgress(workflowJobs) : null

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="cyan">
        Vescape · Android Release{releaseState.repo ? `  ${releaseState.repo}` : ''}
      </Text>
      {status ? <Text>{status}</Text> : null}
      {phase === 'dashboard' && <Dashboard state={releaseState} actions={actions} index={index} />}
      {phase === 'version-bump' && (
        <Box flexDirection="column">
          <Text bold>Choose the next marketing version</Text>
          <Menu
            items={versionBumps.map((item) => ({
              key: item.bump,
              label: `${item.label}: ${currentVersion} → ${bumpMarketingVersion(currentVersion, item.bump)}`,
            }))}
            index={index}
          />
          <Hint>↑/↓ · Enter · Esc goes back</Hint>
        </Box>
      )}
      {phase === 'version-confirm' && (
        <Confirm
          title="Prepare release candidate"
          fields={[
            { label: 'Current version', value: currentVersion },
            {
              label: 'Next version',
              value: (
                <Text color="cyan">
                  {bumpMarketingVersion(currentVersion, versionBumps[bumpIndex].bump)}
                </Text>
              ),
            },
            {
              label: 'Next steps',
              value:
                'notes → commit dev → fast-forward main → push → GitHub release → Android + iOS internal build',
            },
          ]}
          note="No Play upload or production mutation happens yet."
          confirmLabel="Prepare and push this release candidate"
          index={index}
        />
      )}
      {phase === 'build-source' && (
        <Box flexDirection="column">
          <Text bold>Build and send to Internal</Text>
          <Text>
            Source commit: <Text color="yellow">{sourceRef || ' '}</Text>
            {sourceRefEdited ? '' : ' (typing replaces this)'}
          </Text>
          {sourcePreview ? (
            <Text color={sourcePreview.releasedBranch ? 'green' : 'yellow'}>
              {sourcePreview.sha.slice(0, 12)} {sourcePreview.subject}
              {sourcePreview.releasedBranch ? '' : ' · not on origin/main'}
            </Text>
          ) : (
            <Text color={sourceChecking ? 'gray' : 'red'}>
              {sourceChecking ? 'Resolving…' : 'Unknown ref · nothing to build'}
            </Text>
          )}
          <Hint>Type a git ref or SHA · Enter continues · Esc cancels</Hint>
        </Box>
      )}
      {phase === 'internal-runs' && (
        <Box flexDirection="column">
          <Text bold>Watch / resume an Internal release</Text>
          <Menu
            items={internalRuns.map((workflowRun) => ({
              key: String(workflowRun.id),
              label: `#${workflowRun.run_number ?? workflowRun.id}`,
              detail: `${
                workflowRun.status === 'completed'
                  ? (workflowRun.conclusion ?? 'completed')
                  : workflowRun.status.replace('_', ' ')
              } · ${workflowElapsed(workflowRun, clock)} · ${workflowRun.head_sha?.slice(0, 12) ?? 'SHA unknown'}`,
            }))}
            index={index}
          />
          <Hint>Newest first · ↑/↓ · Enter watches · Esc goes back</Hint>
        </Box>
      )}
      {phase === 'candidate' && (
        <Box flexDirection="column">
          <Text bold>Promote Internal → Open testing</Text>
          <Menu
            items={candidates.map((candidate) => ({
              key: String(candidate.workflow.runId),
              label: `v${candidate.marketingVersion}`,
              detail: `${candidate.sourceSha.slice(0, 12)} · phone ${candidate.versionCodes.phone} · Wear ${candidate.versionCodes.wear} · run ${candidate.workflow.runId}`,
            }))}
            index={index}
          />
          <Hint>↑/↓ · Enter selects · Esc cancels</Hint>
        </Box>
      )}
      {phase === 'production-candidate' && (
        <Box flexDirection="column">
          <Text bold>Promote Open → Production</Text>
          <Menu
            items={productionCandidates.map((candidate) => ({
              key: String(candidate.openPromotionRunId),
              label: `v${candidate.manifest.marketingVersion}`,
              detail: `${candidate.manifest.sourceSha.slice(0, 12)} · phone ${candidate.manifest.versionCodes.phone} · Wear ${candidate.manifest.versionCodes.wear} · open proof ${candidate.openPromotionRunId}`,
            }))}
            index={index}
          />
          <Hint>Only successful exact open-promotion manifests · ↑/↓ · Enter · Esc cancels</Hint>
        </Box>
      )}
      {phase === 'production-percentage' && productionPlan && (
        <Box flexDirection="column">
          <Text bold>
            {productionPlan.operation === 'promote' ? 'Initial rollout' : 'Advance rollout'}
          </Text>
          <Text>
            Percentage: <Text color="yellow">{rolloutInput || ' '}%</Text>
          </Text>
          <Hint>Type percentage 0–100 · Enter continues · Esc cancels</Hint>
        </Box>
      )}
      {plan && phase === 'confirm' && (
        <Confirm
          title="Build and send to Internal"
          fields={[
            { label: 'Repository', value: plan.repo },
            {
              label: 'Workflows',
              value: `${plan.workflowRef}:.github/workflows/release-android.yml + release-ios.yml`,
            },
            { label: 'Source SHA', value: plan.sourceSha },
            { label: 'Marketing version', value: plan.marketingVersion },
            {
              label: 'Destination',
              value: 'phone internal + Wear internal + TestFlight internal only',
            },
          ]}
          confirmLabel="Create workflow run"
          index={index}
        />
      )}
      {promotionPlan && phase === 'promote-confirm' && (
        <Confirm
          title="Promote Internal → Open testing"
          fields={promotionFields(promotionPlan)}
          note="Workflow revalidates both exact codes on live Play tracks before mutation."
          confirmLabel="Promote existing Play artifacts"
          index={index}
        />
      )}
      {productionPlan && phase === 'production-confirm' && (
        <Confirm
          title={`Production ${productionPlan.operation}`}
          fields={productionFields(productionPlan)}
          note="Trusted workflow revalidates source ancestry, canonical notes, and both live Play tracks."
          confirmLabel="Run explicitly approved production operation"
          index={index}
        />
      )}
      {phase === 'running' && watchedRun && progress && (
        <Box flexDirection="column">
          <Text>
            <Text color="cyan">[{progress.bar}]</Text> {progress.completed}/{progress.total} stages
          </Text>
          <Text>
            Now: <Text bold>{progress.current}</Text>
          </Text>
          {progress.detail && <Hint>Step: {progress.detail}</Hint>}
          <Box flexDirection="column" marginTop={1}>
            {progress.stages.map((stage) => (
              <Text
                key={stage.name}
                color={
                  stage.state === 'done'
                    ? 'green'
                    : stage.state === 'active'
                      ? 'cyan'
                      : stage.state === 'failed'
                        ? 'red'
                        : undefined
                }
                dimColor={stage.state === 'waiting' || stage.state === 'skipped'}
              >
                {stage.state === 'done'
                  ? '✓'
                  : stage.state === 'active'
                    ? '◆'
                    : stage.state === 'failed'
                      ? '✗'
                      : stage.state === 'skipped'
                        ? '–'
                        : '○'}{' '}
                {stage.name}
              </Text>
            ))}
          </Box>
          <Text>
            Elapsed: {workflowElapsed(watchedRun, clock)} · Remaining: {progress.remaining}
          </Text>
          <Hint>
            Run #{watchedRun.run_number ?? watchedRun.id} · attempt {watchedRun.run_attempt ?? 1} ·{' '}
            {watchedRun.head_sha?.slice(0, 12) ?? 'source SHA unavailable'}
          </Hint>
        </Box>
      )}
      {run && phase !== 'dashboard' && (
        <Text>
          Run: {run.id} · {run.url}
        </Text>
      )}
      {iosRun && phase !== 'dashboard' && (
        <Text>
          iOS run: {iosRun.id} · {iosRun.url}
        </Text>
      )}
      {phase === 'complete' && (
        <Box flexDirection="column">
          <Rule />
          <Hint>
            {retryRunId ? 'R retries failed jobs only · ' : ''}Enter returns to dashboard · Q quits
          </Hint>
        </Box>
      )}
      {phase === 'error' && (
        <Box flexDirection="column">
          <Text color="red">{error}</Text>
          <Hint>Enter returns to dashboard · Q quits</Hint>
        </Box>
      )}
    </Box>
  )
}

export async function runReleaseCli(options: ReleaseCliOptions = {}): Promise<ReleaseCliResult> {
  let result: ReleaseCliResult = { kind: 'exit' }
  const instance = render(<App {...options} finish={(next) => (result = next)} />)
  await instance.waitUntilExit()
  return result
}

if (import.meta.main) await runReleaseCli()
