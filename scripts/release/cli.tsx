import { sendToOpenTesting } from './flows/open'
import React, { useEffect, useRef, useState } from 'react'
import { Box, render, Text, useApp, useInput } from 'ink'
import type { ProductionOperation, ReleaseManifest, WorkflowJob, WorkflowRun } from './contracts'
import { releaseOutcome } from './contracts'
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
import {
  availableActions,
  defaultActionIndex,
  moreActions,
  type ActionId,
} from './dashboard/actions'
import { initialReleaseState, loadReleaseState, type ReleaseState } from './dashboard/state'
import { Confirm, Hint, isEnter, Menu, Rule } from './ui'
import type { Plan, ProductionPlan, PromotionPlan } from './flows/plans'

type Phase =
  | 'dashboard'
  | 'more'
  | 'technical'
  | 'version-bump'
  | 'build-source'
  | 'internal-runs'
  | 'checking'
  | 'candidate'
  | 'production-candidate'
  | 'confirm'
  | 'dispatching'
  | 'waiting'
  | 'running'
  | 'complete'
  | 'error'

const buildStepNames: Record<string, string> = {
  'Release gates': 'Check the app',
  'Build signed artifacts once': 'Build the app',
  'Upload phone internal': 'Upload the phone app',
  'Upload Wear internal': 'Upload the watch app',
  'Publish release manifest': 'Save the build results',
  'Waiting for runner': 'Waiting for a build machine',
}
const buildStepName = (name: string) => buildStepNames[name] ?? name

const versionBumps: ReadonlyArray<{ bump: VersionBump; label: string }> = [
  { bump: 'patch', label: 'Patch: fixes and small changes' },
  { bump: 'minor', label: 'Minor: new features' },
  { bump: 'major', label: 'Major: a major release' },
]

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const CONFIRM_INDEX = 0

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
  const [run, setRun] = useState<{ id: number; url: string } | null>(null)
  const [iosRun, setIosRun] = useState<{ id: number; url: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retryRunId, setRetryRunId] = useState<number | null>(null)
  const inputTransitioning = useRef(false)

  useEffect(() => {
    inputTransitioning.current = false
  }, [phase])

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
    else if (initialSourceRef) void prepare(true)
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
  const advancedActions = moreActions(releaseState)

  const activeRunId = releaseState.activeRun?.id ?? null
  useEffect(() => {
    if (phase === 'dashboard') setIndex(defaultActionIndex(actions, releaseState))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRunId])

  const prepareVersionMenu = async () => {
    goto('checking')
    setStatus('Checking for unfinished changes…')
    try {
      await verifyReleasePreparationReady()
      setCurrentVersion(await currentMarketingVersion())
      setStatus('')
      goto('version-bump')
    } catch (caught) {
      fail(caught)
    }
  }

  const prepare = async (autoDispatch = false) => {
    goto('checking')
    setStatus('Checking the build source and GitHub connection…')
    try {
      await verifyGhAuthentication()
      const repo = await repositoryName()
      const workflowRef = await repositoryDefaultBranch(repo)
      const sourceSha = await resolveSourceSha(sourceRef)
      await verifyRemoteCommit(repo, sourceSha)
      const version = await marketingVersion(repo, sourceSha)
      const nextPlan: Plan = {
        repo,
        workflowRef,
        sourceSha,
        marketingVersion: version,
        requestId: crypto.randomUUID(),
      }
      setPlan(nextPlan)
      setStatus('')
      if (autoDispatch) void dispatch(nextPlan)
      else goto('confirm')
    } catch (caught) {
      fail(caught)
    }
  }

  const preparePromotion = async (chooseCandidate = false) => {
    goto('checking')
    setStatus('Checking the selected build…')
    try {
      await verifyGhAuthentication()
      const repo = await repositoryName()
      const [available, tracks, workflowRef] = await Promise.all([
        chooseCandidate
          ? listInternalCandidates(repo)
          : releaseState.internal
            ? downloadManifest(releaseState.internal.runId).then((candidate) => [candidate])
            : Promise.resolve([]),
        releaseTrackConfig(repo),
        repositoryDefaultBranch(repo),
      ])
      if (available.length === 0)
        throw new Error('No uploaded builds are available for Open testing.')
      setCandidates(available)
      const nextPlan: PromotionPlan = {
        repo,
        workflowRef,
        candidate: available[0],
        requestId: crypto.randomUUID(),
        notesPath: '',
        tracks,
      }
      setPromotionPlan(nextPlan)
      if (chooseCandidate) {
        setStatus('')
        goto('candidate')
      } else {
        await sendOpenCandidate(nextPlan)
      }
    } catch (caught) {
      fail(caught)
    }
  }

  const sendOpenCandidate = async (plan: PromotionPlan) => {
    await sendToOpenTesting(
      plan.candidate,
      (candidate) => canonicalNotesPath(plan.repo, candidate.marketingVersion, candidate.sourceSha),
      async (candidate, notesPath) => {
        const ready = { ...plan, candidate, notesPath }
        setPromotionPlan(ready)
        await promote(ready)
      },
    )
  }

  const confirmPromotionCandidate = async (candidateIndex: number) => {
    const candidate = candidates[candidateIndex]
    if (!promotionPlan || !candidate) return
    goto('checking')
    setStatus('Checking release notes…')
    try {
      await sendOpenCandidate({ ...promotionPlan, candidate })
    } catch (caught) {
      fail(caught)
    }
  }

  const applyProductionCandidate = async (
    basePlan: ProductionPlan,
    candidate: ProductionCandidate,
  ) => {
    setStatus(`Checking release notes for ${candidate.manifest.marketingVersion}…`)
    const notesPath = await canonicalNotesPath(
      basePlan.repo,
      candidate.manifest.marketingVersion,
      candidate.manifest.sourceSha,
    )
    const next = { ...basePlan, candidate, notesPath }
    setProductionPlan(next)
    setStatus('')
    await runProduction(next)
  }

  /**
   * A status refresh reads whatever is already on production, so only `promote` needs the
   * candidate picker; `status` resolves its candidate from the recorded production version.
   */
  const prepareProduction = async (operation: ProductionOperation, chooseCandidate = false) => {
    goto('checking')
    setStatus('Checking builds available in Open testing…')
    try {
      await verifyGhAuthentication()
      const repo = await repositoryName()
      const [available, tracks, workflowRef] = await Promise.all([
        listProductionCandidates(repo),
        releaseTrackConfig(repo),
        repositoryDefaultBranch(repo),
      ])
      if (available.length === 0)
        throw new Error('No builds are ready to publish from Open testing.')
      const basePlan: ProductionPlan = {
        repo,
        workflowRef,
        candidate: available[0],
        requestId: crypto.randomUUID(),
        notesPath: '',
        tracks,
        operation,
      }
      if (operation === 'promote') {
        if (chooseCandidate) {
          setProductionCandidates(available)
          setProductionPlan(basePlan)
          setStatus('')
          goto('production-candidate')
          return
        }
        await applyProductionCandidate(basePlan, available[0])
        return
      }
      const live = releaseState.production
      const target = live
        ? available.find((candidate) => candidate.openPromotionRunId === live.openPromotionRunId)
        : undefined
      if (!target)
        throw new Error(
          live
            ? `Could not find the build record for the current production release. Check its GitHub progress link.`
            : 'No production release has been recorded yet.',
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

  const prepareInternalRuns = async () => {
    goto('checking')
    setStatus('Finding recent Internal releases…')
    try {
      await verifyGhAuthentication()
      const repo = await repositoryName()
      const available = await listInternalWorkflowRuns(repo)
      if (available.length === 0) throw new Error('No previous Internal builds were found.')
      setInternalRunsRepo(repo)
      setInternalRuns(available)
      setStatus('')
      goto('internal-runs')
    } catch (caught) {
      fail(caught)
    }
  }

  const finishInternalRun = async (repo: string, workflowRun: WorkflowRun) => {
    setStatus('Checking the upload results…')
    let manifest
    try {
      manifest = await downloadManifest(workflowRun.id)
    } catch (manifestError) {
      if (workflowRun.conclusion !== 'success') {
        const failedJobs = await failedWorkflowJobs(repo, workflowRun.id)
        throw new Error(
          `Build failed${failedJobs.length > 0 ? ` in ${failedJobs.join(', ')}` : ''}. ${workflowRun.html_url}`,
        )
      }
      throw manifestError
    }
    const outcome = releaseOutcome(manifest)
    if (outcome.kind === 'success') {
      setStatus('Ready for Internal testing')
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
      setStatus(`Building and uploading for Internal testing…`)
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
    setStatus('Checking build progress…')
    try {
      const current = await getWorkflowRun(internalRunsRepo, selected.id)
      await watchInternalRun(internalRunsRepo, current)
    } catch (caught) {
      fail(caught)
    }
  }

  const continueActiveRun = async () => {
    if (!releaseState.repo || !releaseState.activeRun) return
    goto('checking')
    setStatus('Checking build progress…')
    try {
      const current = await getWorkflowRun(releaseState.repo, releaseState.activeRun.id)
      await watchInternalRun(releaseState.repo, current)
    } catch (caught) {
      fail(caught)
    }
  }

  const reviewFailedRun = async () => {
    if (!releaseState.repo || !releaseState.failedRun) return
    goto('checking')
    setStatus('Checking what went wrong…')
    try {
      const jobs = await failedWorkflowJobs(releaseState.repo, releaseState.failedRun.id)
      setRun({ id: releaseState.failedRun.id, url: releaseState.failedRun.html_url })
      setRetryRunId(releaseState.failedRun.id)
      setStatus(`Internal release failed${jobs.length ? ` in ${jobs.join(', ')}` : ''}`)
      goto('complete')
    } catch (caught) {
      fail(caught)
    }
  }

  const dispatch = async (confirmedPlan: Plan) => {
    goto('dispatching')
    setStatus(`Publishing the v${confirmedPlan.marketingVersion} GitHub release…`)
    try {
      await publishGithubRelease(confirmedPlan.repo, confirmedPlan)
      setStatus(`Release notes published. Starting Android and iOS builds…`)
      const payload = createDispatchPayload(
        confirmedPlan.sourceSha,
        confirmedPlan.requestId,
        confirmedPlan.workflowRef,
      )
      setIosRun(null)
      await dispatchInternalBuild(confirmedPlan.repo, payload)
      await dispatchIosInternalBuild(confirmedPlan.repo, payload)
      goto('waiting')
      setStatus('Waiting for GitHub to start the builds…')
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
      if (!workflowRun)
        throw new Error(
          'GitHub accepted the build request, but has not reported progress yet. Check GitHub before starting another build.',
        )
      await watchInternalRun(confirmedPlan.repo, workflowRun)
    } catch (caught) {
      fail(caught)
    }
  }

  const promote = async (confirmedPlan: PromotionPlan) => {
    goto('dispatching')
    setStatus(`Sending ${confirmedPlan.candidate.marketingVersion} to Open testing…`)
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
      setStatus('Starting Open testing promotion…')
      let workflowRun = null
      for (let attempt = 0; attempt < 30 && !workflowRun; attempt += 1) {
        workflowRun = await findPromotionRun(confirmedPlan.repo, confirmedPlan.requestId)
        if (!workflowRun) await sleep(2_000)
      }
      if (!workflowRun)
        throw new Error(
          'GitHub accepted the request, but has not reported progress yet. Check GitHub before sending again.',
        )
      setRun({ id: workflowRun.id, url: workflowRun.html_url })
      goto('running')
      while (workflowRun.status !== 'completed') {
        setStatus(`Sending the build to Open testing…`)
        await sleep(10_000)
        workflowRun = await getWorkflowRun(confirmedPlan.repo, workflowRun.id)
      }
      setStatus('Checking whether phone and watch are available to testers…')
      const manifest = await downloadPromotionManifest(workflowRun.id)
      setStatus(
        manifest.phone.status === 'failed' || manifest.wear.status === 'failed'
          ? 'Open testing was not fully updated. Retry the failed steps.'
          : manifest.marketingVersion + ' is available in Open testing on phone and watch.',
      )
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
    setStatus(`Starting the Google Play update…`)
    try {
      await dispatchProduction(
        confirmedPlan.repo,
        createProductionDispatchPayload(
          confirmedPlan.candidate,
          confirmedPlan.operation,
          confirmedPlan.requestId,
          confirmedPlan.workflowRef,
        ),
      )
      goto('waiting')
      setStatus('Waiting for GitHub to start the production update…')
      let workflowRun = null
      for (let attempt = 0; attempt < 30 && !workflowRun; attempt += 1) {
        workflowRun = await findProductionRun(confirmedPlan.repo, confirmedPlan.requestId)
        if (!workflowRun) await sleep(2_000)
      }
      if (!workflowRun)
        throw new Error(
          'GitHub accepted the request, but has not reported progress yet. Check GitHub before publishing again.',
        )
      setRun({ id: workflowRun.id, url: workflowRun.html_url })
      goto('running')
      while (workflowRun.status !== 'completed') {
        setStatus(`Checking the Google Play update…`)
        await sleep(10_000)
        workflowRun = await getWorkflowRun(confirmedPlan.repo, workflowRun.id)
      }
      setStatus('Checking what is live on Google Play…')
      const manifest = await downloadProductionManifest(workflowRun.id)
      setStatus(
        manifest.phone.status === 'failed' || manifest.wear.status === 'failed'
          ? 'Google Play was not fully updated. Retry the failed steps.'
          : manifest.githubRelease === 'failed'
            ? 'Google Play is updated, but updating the GitHub release failed.'
            : manifest.marketingVersion + ' is live on Google Play for phone and watch.',
      )
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
    if (id === 'watch') {
      if (releaseState.activeRun) void continueActiveRun()
      else if (releaseState.failedRun) void reviewFailedRun()
      else void prepareInternalRuns()
    } else if (id === 'promote-open') void preparePromotion()
    else if (id === 'promote-production') void prepareProduction('promote')
    else if (id === 'status') void prepareProduction('status')
    else if (id === 'choose-open') void preparePromotion(true)
    else if (id === 'choose-production') void prepareProduction('promote', true)
    else if (id === 'build') gotoBuildSource()
    else if (id === 'continue-prepared') void prepare(true)
    else if (id === 'resume-draft' && releaseState.draft) {
      finish({ kind: 'prepare', bump: releaseState.draft.bump })
      exit()
    } else if (id === 'prepare') void prepareVersionMenu()
    else if (id === 'more') goto('more')
    else if (id === 'technical') goto('technical')
    else if (id === 'exit') {
      finish({ kind: 'exit' })
      exit()
    } else loadDashboard()
  }

  const moveIndex = (key: { upArrow: boolean; downArrow: boolean }, length: number) => {
    if (length === 0) return
    if (key.upArrow) setIndex((value) => (value - 1 + length) % length)
    else if (key.downArrow) setIndex((value) => (value + 1) % length)
  }

  useInput((input, key) => {
    const enter = isEnter(input, key)
    if (phase === 'dashboard' && releaseState.loading && !releaseState.error) return
    if (enter) {
      if (inputTransitioning.current) return
      inputTransitioning.current = true
    }
    if (phase === 'dashboard') {
      moveIndex(key, actions.length)
      if (enter && actions[index]) startAction(actions[index].id)
      else if (key.escape) {
        finish({ kind: 'exit' })
        exit()
      }
      return
    }
    if (phase === 'more') {
      moveIndex(key, advancedActions.length)
      if (enter && advancedActions[index]) startAction(advancedActions[index].id)
      else if (key.escape) goto('dashboard')
      return
    }
    if (phase === 'technical') {
      if (key.escape || enter) goto('more')
      return
    }
    if (phase === 'version-bump') {
      moveIndex(key, versionBumps.length)
      if (enter) {
        finish({ kind: 'prepare', bump: versionBumps[index].bump })
        exit()
      } else if (key.escape) loadDashboard()
      return
    }
    if (phase === 'build-source') {
      if (enter) {
        if (sourcePreview) void prepare()
        else inputTransitioning.current = false
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
    if (phase === 'confirm') {
      moveIndex(key, 2)
      if (enter) {
        if (index === CONFIRM_INDEX && plan) void dispatch(plan)
        else gotoBuildSource()
      } else if (key.escape) gotoBuildSource()
      return
    }
    if (phase === 'complete' && retryRunId && input.toLowerCase() === 'r') {
      setRetryRunId(null)
      setWatchedRun(null)
      goto('running')
      setStatus('Retrying the failed steps…')
      void retryFailedJobs(retryRunId)
        .then(() => {
          setStatus(`Retry started. Open the GitHub progress link below to follow it.`)
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
      {phase === 'more' && (
        <Box flexDirection="column">
          <Text bold>More options</Text>
          <Menu
            items={advancedActions.map((action) => ({ key: action.id, label: action.label }))}
            index={index}
          />
          <Hint>↑/↓ · Enter · Esc goes back</Hint>
        </Box>
      )}
      {phase === 'technical' && (
        <Box flexDirection="column">
          <Text bold>Technical details</Text>
          <Text>Repository: {releaseState.repo ?? '—'}</Text>
          <Text>Dev version: {releaseState.devVersion ?? '—'}</Text>
          <Text>
            Internal codes: {releaseState.internal?.phone ?? '—'} /{' '}
            {releaseState.internal?.wear ?? '—'}
          </Text>
          <Text>Internal run: {releaseState.internal?.runId ?? '—'}</Text>
          <Text>Open run: {releaseState.open?.runId ?? '—'}</Text>
          <Text>Production run: {releaseState.production?.runId ?? '—'}</Text>
          <Hint>Enter or Esc goes back</Hint>
        </Box>
      )}
      {phase === 'version-bump' && (
        <Box flexDirection="column">
          <Text bold>What kind of release is this?</Text>
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
          <Hint>Builds available in Open testing · ↑/↓ · Enter · Esc goes back</Hint>
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
          confirmLabel="Start build"
          index={index}
        />
      )}
      {phase === 'running' && watchedRun && progress && (
        <Box flexDirection="column">
          <Text>
            <Text color="cyan">[{progress.bar}]</Text> {progress.completed}/{progress.total} stages
          </Text>
          <Text>
            Now: <Text bold>{buildStepName(progress.current)}</Text>
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {progress.stages.map((stage) => (
              <Text
                key={buildStepName(stage.name)}
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
                {buildStepName(stage.name)}
              </Text>
            ))}
          </Box>
          <Text>
            Elapsed: {workflowElapsed(watchedRun, clock)} · Remaining: {progress.remaining}
          </Text>
        </Box>
      )}
      {run && phase !== 'dashboard' && <Text>View progress on GitHub: {run.url}</Text>}
      {iosRun && phase !== 'dashboard' && <Text>iOS build progress: {iosRun.url}</Text>}
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
  instance.clear()
  instance.unmount()
  return result
}

if (import.meta.main) await runReleaseCli()
