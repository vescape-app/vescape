import { accentColors, type ResolvedTheme } from '@/constants/theme'
import { useThemeStore } from '@/hooks/useTheme'
import { useBoardStore } from '@/modules/board/store/boardStore'

export function useSelectedBoardRailColor(): string | null {
  const colorId = useBoardStore(
    (state) =>
      state.boards.find((board) => board.id === state.activeBoardId)?.personalization?.railColorId,
  )
  const appearance = useThemeStore((state) => state.resolvedTheme)
  return railColor(colorId, appearance)
}

export function railColor(colorId: string | undefined, appearance: ResolvedTheme): string | null {
  if (!colorId) return null
  return (
    accentColors[appearance][
      (colorId === 'group-ride' ? 'mint' : colorId) as keyof typeof accentColors.dark
    ]?.color ?? null
  )
}
