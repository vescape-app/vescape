import type { ReleaseState } from './state'

export type ActionId =
  | 'watch'
  | 'promote-open'
  | 'promote-production'
  | 'status'
  | 'build'
  | 'prepare'
  | 'refresh'
  | 'more'
  | 'technical'
  | 'exit'
  | 'choose-open'
  | 'choose-production'
  | 'continue-prepared'
  | 'resume-draft'

export interface DashboardAction {
  id: ActionId
  label: string
}

/**
 * Only operations valid in the current recorded state. Preparing a version starts the pipeline and
 * is by far the most used entry, so it leads; the rest follow pipeline order.
 */
export function availableActions(state: ReleaseState): DashboardAction[] {
  const actions: DashboardAction[] = []
  const { activeRun, internal, open, production } = state

  if (activeRun) {
    actions.push({ id: 'watch', label: 'Continue the running Internal release' })
  } else if (state.failedRun) {
    actions.push({ id: 'watch', label: 'Review and retry the failed Internal release' })
  }
  if (!activeRun && state.draft) {
    actions.push({ id: 'resume-draft', label: `Resume draft ${state.draft.version}` })
  }
  if (!activeRun && state.preparedVersion && state.preparedVersion !== internal?.marketingVersion) {
    actions.push({
      id: 'continue-prepared',
      label: `Build ${state.preparedVersion} for Internal`,
    })
  }
  if (
    internal &&
    internal.runId === state.promotableInternalRunId &&
    internal.runId !== open?.sourceRunId
  ) {
    actions.push({
      id: 'promote-open',
      label: `Send ${internal.marketingVersion} to Open testing`,
    })
  }

  if (
    open &&
    open.runId === state.productionEligibleOpenRunId &&
    open.runId !== production?.sourceRunId
  ) {
    actions.push({
      id: 'promote-production',
      label: `Publish ${open.marketingVersion} to production`,
    })
  }
  actions.push({ id: 'prepare', label: 'Prepare a new release' })
  actions.push({ id: 'more', label: 'More options' })
  actions.push({ id: 'exit', label: 'Exit' })

  return actions
}

/**
 * Preselection is separate from ordering: preparing leads the list, but a running release is the
 * thing you opened the dashboard for, so Enter still watches it.
 */
export function defaultActionIndex(
  _actions: readonly DashboardAction[],
  _state: ReleaseState,
): number {
  return 0
}

export function moreActions(state: ReleaseState): DashboardAction[] {
  const actions: DashboardAction[] = []
  if (!state.activeRun && !state.failedRun)
    actions.push({ id: 'watch', label: 'Choose a previous Internal run' })
  actions.push({ id: 'build', label: 'Build a specific git ref' })
  actions.push({ id: 'choose-open', label: 'Choose an Internal build for Open testing' })
  actions.push({ id: 'choose-production', label: 'Choose an Open build for production' })
  if (state.production) actions.push({ id: 'status', label: 'Refresh live Play status' })
  actions.push({ id: 'technical', label: 'Technical details' })
  actions.push({ id: 'refresh', label: 'Reload release status' })
  return actions
}
