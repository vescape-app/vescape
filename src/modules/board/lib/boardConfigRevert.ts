import {
  applyBoardConfigChangeset,
  type BoardConfigRevertPlan,
  type BoardConfigValues,
} from 'vescape-core'

import { boardConfigErrorMessage } from '@/modules/board/lib/boardConfigErrors'

export function resolveRevertReviewState(params: {
  plan: BoardConfigRevertPlan | null
  selectedBoardId: string | null | undefined
  connectedBoardId: string | null | undefined
  canRevert: boolean
  applyError: string | null
}) {
  const { plan, selectedBoardId, connectedBoardId, canRevert, applyError } = params
  const visible = plan !== null
  const hasWritableChanges = plan !== null && Object.keys(plan.changes).length > 0
  const boardMatchesPlan =
    plan !== null &&
    connectedBoardId === plan.boardId &&
    (!selectedBoardId || selectedBoardId === plan.boardId)
  const confirmDisabled = !canRevert || !hasWritableChanges || !boardMatchesPlan
  return {
    visible,
    confirmDisabled,
    error:
      applyError ??
      (!canRevert && visible ? 'Board disconnected. Reconnect to apply revert.' : null),
  }
}

export async function applyPlannedBoardConfigRevert(params: {
  plan: BoardConfigRevertPlan | null
  canRevert: boolean
  connectedBoardId: string | null | undefined
  currentSchemaHash: string | null | undefined
  plannedCapturedAtMs?: number | null
  currentCapturedAtMs?: number | null
  applyChangeset?: typeof applyBoardConfigChangeset
}): Promise<
  | { kind: 'noop' }
  | { kind: 'error'; message: string }
  | { kind: 'applied'; boardId: string; updated: BoardConfigValues }
> {
  const {
    plan,
    canRevert,
    connectedBoardId,
    currentSchemaHash,
    plannedCapturedAtMs,
    currentCapturedAtMs,
  } = params
  const applyChangeset = params.applyChangeset ?? applyBoardConfigChangeset
  if (!plan || Object.keys(plan.changes).length === 0) {
    return { kind: 'noop' }
  }
  if (!canRevert || connectedBoardId !== plan.boardId) {
    return { kind: 'error', message: 'Board disconnected. Reconnect to apply revert.' }
  }
  if (currentSchemaHash && plan.currentSchemaHash !== currentSchemaHash) {
    return {
      kind: 'error',
      message: 'Board firmware schema changed since this revert was planned. Plan it again.',
    }
  }
  if (
    plannedCapturedAtMs != null &&
    currentCapturedAtMs != null &&
    plannedCapturedAtMs !== currentCapturedAtMs
  ) {
    return {
      kind: 'error',
      message: 'Board config changed since this revert was planned. Plan it again.',
    }
  }
  try {
    const updated = await applyChangeset(
      plan.boardId,
      plan.changes,
      'revert',
      plan.currentSchemaHash,
    )
    return { kind: 'applied', boardId: plan.boardId, updated }
  } catch (err) {
    return {
      kind: 'error',
      message: boardConfigErrorMessage(err, 'Unable to revert board config.'),
    }
  }
}
