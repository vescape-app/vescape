import { accentColors, type ResolvedTheme } from '@/constants/theme'
import { useThemeStore } from '@/hooks/useTheme'
import { useBoardStore } from '@/modules/board/store/boardStore'

/** The selected Board owns the Rider's own color. No Board or unknown rail color means no tint. */
export function useSelectedBoardRailColor(): string | null {
  const colorId = useBoardStore(
    (state) =>
      state.boards.find((board) => board.id === state.activeBoardId)?.personalization?.railColorId,
  )
  const appearance = useThemeStore((state) => state.resolvedTheme)
  return railColor(colorId, appearance)
}

/** The accent a Board rail color id resolves to (`group-ride` is mint); unknown ids are no tint. */
export function railColor(colorId: string | undefined, appearance: ResolvedTheme): string | null {
  if (!colorId) return null
  return (
    accentColors[appearance][
      (colorId === 'group-ride' ? 'mint' : colorId) as keyof typeof accentColors.dark
    ]?.color ?? null
  )
}
