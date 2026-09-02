import type { HistorySession } from '@/modules/history/store/historyStore'
import type { HistoryTab } from '@/screens/main/mainScreenStore'

export type HistoryTarget =
  | { kind: 'ride'; session: HistorySession }
  | { kind: 'favorite'; favoriteId: string; session: HistorySession }

interface HistoryTargetActions {
  enterHistory: () => void
  setHistoryTab: (tab: HistoryTab) => void
  openFavorite: (id: string) => void
  closeFavorite: () => void
  setHistorySheetVisible: (visible: boolean) => void
  setOpenMediaAssetId: (id: string | null) => void
  selectSession: (session: HistorySession) => Promise<void>
}

/** Opens one exact drawer/list target without deriving its identity again after async work. */
export function openHistoryTarget(
  target: HistoryTarget,
  actions: HistoryTargetActions,
): Promise<void> {
  actions.setOpenMediaAssetId(null)
  actions.setHistorySheetVisible(false)
  if (target.kind === 'favorite') {
    actions.setHistoryTab('favorites')
    actions.openFavorite(target.favoriteId)
  } else {
    actions.setHistoryTab('history')
    actions.closeFavorite()
  }
  const selection = actions.selectSession(target.session)
  actions.enterHistory()
  return selection
}
