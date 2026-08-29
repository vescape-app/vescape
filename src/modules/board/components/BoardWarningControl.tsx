import { useRef, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { EngineIcon } from 'phosphor-react-native'

import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { BoardWarningsSheet } from '@/modules/board/components/BoardWarningsSheet'
import { severityStatus } from '@/modules/board/constants/boardWarnings'
import { worstSeverity } from '@/modules/board/lib/boardWarnings'
import { indicatorFaults } from '@/modules/board/lib/vescFaults'
import { EMPTY_WARNINGS, useBoardWarningsStore } from '@/modules/board/store/boardWarningsStore'
import { EMPTY_FAULTS, useVescFaultsStore } from '@/modules/board/store/vescFaultsStore'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'
import { theme } from '@/constants/theme'

interface BoardWarningControlProps {
  boardId: string
}

/**
 * Shared Board health icon for the top board bar, plus its sheet. Renders nothing when the board is
 * clean — the absence of the icon is itself the "all good" signal. Both Board Warnings and VESC
 * Fault Occurrences drive it, under their own independent kill switches, so turning one off never
 * silences the other. Warnings and faults are durable, so the icon stays for the selected board even
 * while disconnected. Sits inside the board pill, so it owns a leading divider to match the
 * edit/disconnect controls.
 */
export function BoardWarningControl({ boardId }: BoardWarningControlProps) {
  const anchorRef = useRef<View>(null)
  const [open, setOpen] = useState(false)
  const warnings = useBoardWarningsStore((s) => s.warningsByBoard[boardId] ?? EMPTY_WARNINGS)
  const dismissedKinds = useBoardStore(
    (s) => s.boards.find((b) => b.id === boardId)?.dismissedWarnings,
  )
  const faults = useVescFaultsStore((s) => s.faultsByBoard[boardId] ?? EMPTY_FAULTS)
  const boardWarningsEnabled = useSettingsStore((s) => s.boardWarningsEnabled)
  const vescFaultCollectionEnabled = useSettingsStore((s) => s.vescFaultCollectionEnabled)
  // Dismissed (acknowledged) warnings stay in the sheet but stop driving the indicator — a board
  // whose every warning is dismissed shows no icon at all.
  const activeWarnings = dismissedKinds?.length
    ? warnings.filter((w) => !dismissedKinds.includes(w.kind))
    : warnings
  const visibleWarnings = boardWarningsEnabled ? warnings : EMPTY_WARNINGS
  const worst = worstSeverity(boardWarningsEnabled ? activeWarnings : EMPTY_WARNINGS)
  // A new, undismissed, non-baseline occurrence drives the icon until the rider dismisses it. Fault
  // collection being off hides fault-driven indicators but keeps stored evidence readable below.
  const hasNewFaults = vescFaultCollectionEnabled && indicatorFaults(faults).length > 0

  // Both kill switches off: nothing this control owns is allowed on screen.
  if (!boardWarningsEnabled && !vescFaultCollectionEnabled) return null

  // Icon shows only when the board has something to report. The sheet stays mounted while open even
  // after the last finding is cleared from inside it, so it can show its empty state and animate
  // closed rather than being yanked out mid-interaction.
  const flagged = worst != null || hasNewFaults
  if (!flagged && !open) return null
  const color = severityStatus(worst ?? 'warn').color

  return (
    <>
      {flagged && (
        <>
          <View style={styles.divider} />
          <View ref={anchorRef} collapsable={false}>
            <Pressable
              style={styles.button}
              onPress={() => setOpen(true)}
              testID="board-warnings-button"
              accessibilityLabel="Board health"
            >
              <EngineIcon size={14} color={color} weight="bold" />
            </Pressable>
          </View>
        </>
      )}

      <EdgeDrawer
        visible={open}
        triggerRef={anchorRef}
        title="Board health"
        icon={EngineIcon}
        iconColor={color}
        onClose={() => setOpen(false)}
      >
        <BoardWarningsSheet boardId={boardId} warnings={visibleWarnings} faults={faults} />
      </EdgeDrawer>
    </>
  )
}

const styles = StyleSheet.create({
  divider: {
    width: 1,
    height: 20,
    backgroundColor: theme.neutral.border,
  },
  button: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
