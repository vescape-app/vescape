import { boardPinnedPresetCount } from '@/modules/alerts/lib/boardAlertSettings'
import { useBoardStore } from '@/modules/board/store/boardStore'

/** Active board's presets that pin their own pack, so an app-wide change skips them. */
export function usePinnedPresetCount(): number {
  return useBoardStore((s) =>
    boardPinnedPresetCount(s.boards.find((board) => board.id === s.activeBoardId)),
  )
}
