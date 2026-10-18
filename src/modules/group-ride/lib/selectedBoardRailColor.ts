import { accentColors, type ResolvedTheme } from '@/constants/theme'
import { useThemeStore } from '@/hooks/useTheme'
import { useBoardStore } from '@/modules/board/store/boardStore'

/** The selected Board owns the Rider's color. No Board or unknown rail color means no tint. */
export function selectedBoardRailColor(appearance: ResolvedTheme): string | null {
  const { boards, activeBoardId } = useBoardStore.getState()
  const colorId = boards.find((board) => board.id === activeBoardId)?.personalization?.railColorId
  if (!colorId) return null
  return resolveRailColor(colorId, appearance)
}

export function useSelectedBoardRailColor(): string | null {
  const colorId = useBoardStore(
    (state) =>
      state.boards.find((board) => board.id === state.activeBoardId)?.personalization?.railColorId,
  )
  const appearance = useThemeStore((state) => state.resolvedTheme)
  if (!colorId) return null
  return resolveRailColor(colorId, appearance)
}

function resolveRailColor(colorId: string, appearance: ResolvedTheme): string | null {
  return (
    accentColors[appearance][
      (colorId === 'group-ride' ? 'mint' : colorId) as keyof typeof accentColors.dark
    ]?.color ?? null
  )
}
