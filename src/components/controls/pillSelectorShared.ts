import { createContext, useContext, type ReactNode } from 'react'
import { StyleSheet, type View } from 'react-native'

import { theme } from '@/constants/theme'

export interface ActiveTheme {
  bg: string
  border: string
  color: string
}

export interface PillSelectorCtx {
  activeId: string
  openMenu: (id: string, triggerRef: React.RefObject<View | null>, content: ReactNode) => void
  closeMenu: () => void
  addRef: React.RefObject<View | null>
  contained: boolean
  variant: 'control' | 'lightTabs'
}

export const PillSelectorContext = createContext<PillSelectorCtx | null>(null)
export const TUNE_OPTION_WIDTH = 38
export const TUNE_DEFAULT_ACTIVE_WIDTH = 112
export const TUNE_ANIMATION = { duration: 180 } as const
export const TRANSPARENT = theme.alpha(theme.palette.mono.black, 0)

export type PillSelectorLabelBehavior = 'active-only' | 'always'
export type PillSelectorSlotVisibility = 'active' | 'inactive' | 'always'

export function usePillSelectorCtx() {
  const ctx = useContext(PillSelectorContext)
  if (!ctx) throw new Error('PillSelectorItem must be inside PillSelector')
  return ctx
}

export const styles = StyleSheet.create({
  addPill: {
    height: 36,
    width: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: theme.control.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collapsingPillPressable: {
    width: '100%',
    height: '100%',
    gap: 0,
    paddingHorizontal: 10,
  },
  containedAddPill: {
    borderWidth: 0,
    borderStyle: 'solid',
    backgroundColor: theme.alpha(theme.palette.mono.black, 0),
  },
  containedContainer: {
    height: 38,
    marginHorizontal: 0,
    borderRadius: 19,
    overflow: 'hidden',
    backgroundColor: theme.control.background,
    borderWidth: 1,
    borderColor: theme.control.border,
  },
  lightTabPill: {
    borderWidth: 1,
  },
  containedPill: {
    height: 36,
    borderRadius: 18,
    borderWidth: 0,
  },
  containedScrollContent: {
    minWidth: 0,
    height: 36,
    paddingHorizontal: 1,
    gap: 0,
  },
  container: {
    marginHorizontal: -16,
  },
  disabledDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: theme.control.textMuted,
  },
  draftDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: theme.control.textMuted,
  },
  enabledDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.palette.green.color,
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconPill: {
    height: TUNE_OPTION_WIDTH,
    width: TUNE_OPTION_WIDTH,
    maxWidth: TUNE_DEFAULT_ACTIVE_WIDTH,
    paddingHorizontal: 0,
    borderRadius: TUNE_OPTION_WIDTH / 2,
    overflow: 'hidden',
  },
  menu: {
    paddingVertical: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 44,
  },
  menuItemSeparator: {
    borderTopWidth: 1,
    borderTopColor: theme.control.divider,
  },
  menuItemText: {
    color: theme.control.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  menuItemTextDanger: {
    color: theme.status.error.text,
  },
  pill: {
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    maxWidth: 160,
    overflow: 'hidden',
  },
  pillPressable: {
    height: 36,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '700',
  },
  pillTextInactive: {
    color: theme.control.textMuted,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center',
    minWidth: '100%',
  },
  scrollContentCentered: {
    justifyContent: 'center',
  },
})
