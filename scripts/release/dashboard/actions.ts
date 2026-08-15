import type { ReleaseState } from './state'

export type ActionId =
  | 'watch'
  | 'promote-open'
  | 'promote-production'
  | 'advance'
  | 'halt'
  | 'resume'
  | 'status'
  | 'build'
  | 'prepare'
  | 'refresh'

export interface DashboardAction {
  id: ActionId
  label: string
}

/**
 * Only operations valid in the current recorded state, ordered by how far along the pipeline they
 * are — the next thing to do sits at the top and is preselected.
 */
export function availableActions(state: ReleaseState): DashboardAction[] {
  const actions: DashboardAction[] = []
  const { activeRun, internal, open, production } = state

  actions.push({
    id: 'watch',
    label: activeRun
      ? `Watch running Internal release #${activeRun.run_number ?? activeRun.id}`
      : 'Watch / resume an Internal release',
  })

  if (state.pendingInternal > 0 && internal) {
    actions.push({
      id: 'promote-open',
      label: `Promote ${internal.marketingVersion} → Open testing`,
    })
  }

  if (state.pendingOpen > 0 && open) {
    actions.push({
      id: 'promote-production',
      label: `Promote ${open.marketingVersion} → Production`,
    })
  }

  if (production) {
    const rollout = production.rolloutPercentage
    if (production.halted) {
      actions.push({ id: 'resume', label: `Resume halted ${production.marketingVersion} rollout` })
    } else if (rollout !== null && rollout < 100) {
      actions.push({
        id: 'advance',
        label: `Advance ${production.marketingVersion} rollout (${rollout}% → …)`,
      })
      actions.push({ id: 'halt', label: `Halt ${production.marketingVersion} rollout` })
    }
    actions.push({ id: 'status', label: 'Refresh live Play rollout status' })
  }

  actions.push({ id: 'build', label: 'Build and send to Internal' })
  actions.push({ id: 'prepare', label: 'Prepare a new release version' })
  actions.push({ id: 'refresh', label: 'Reload dashboard' })

  return actions
}
