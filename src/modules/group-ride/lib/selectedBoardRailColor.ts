import { accentColors, type ResolvedTheme } from '@/constants/theme'
import { useThemeStore } from '@/hooks/useTheme'
import { useBoardStore } from '@/modules/board/store/boardStore'

/** The selected Board owns the Rider's color. No Board or unknown rail color means no tint. */
export function selectedBoardRailColor(appearance: ResolvedTheme): string | null {
  const { boards, activeBoardId } = useBoardStore.getState()
  const colorId = boards.find((board) => board.id === activeBoardId)?.personalization?.railColorId
  if (!colorId) return null
  const accent = accentColors[appearance][colorId as keyof typeof accentColors.dark]
  return accent?.color ?? null
}

export function useSelectedBoardRailColor(): string | null {
  const colorId = useBoardStore(
    (state) =>
      state.boards.find((board) => board.id === state.activeBoardId)?.personalization?.railColorId,
  )
  const appearance = useThemeStore((state) => state.resolvedTheme)
  if (!colorId) return null
  return accentColors[appearance][colorId as keyof typeof accentColors.dark]?.color ?? null
}
