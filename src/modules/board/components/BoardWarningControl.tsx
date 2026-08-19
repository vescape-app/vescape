import { useRef, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { WarningIcon } from 'phosphor-react-native'

import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { BoardWarningsSheet } from '@/modules/board/components/BoardWarningsSheet'
import { severityStatus } from '@/modules/board/constants/boardWarnings'
import { worstSeverity } from '@/modules/board/lib/boardWarnings'
import { EMPTY_WARNINGS, useBoardWarningsStore } from '@/modules/board/store/boardWarningsStore'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'
import { theme } from '@/constants/theme'

interface BoardWarningControlProps {
  boardId: string
}

/**
 * Severity-colored Board Warning icon for the top board bar, plus its warnings sheet. Renders nothing
 * when the board is clean — the absence of the icon is itself the "all good" signal. Warnings are
 * durable, so the icon stays for the selected board even while disconnected. Sits inside the board
 * pill, so it owns a leading divider to match the edit/disconnect controls.
 */
export function BoardWarningControl({ boardId }: BoardWarningControlProps) {
  const anchorRef = useRef<View>(null)
  const [open, setOpen] = useState(false)
  const warnings = useBoardWarningsStore((s) => s.warningsByBoard[boardId] ?? EMPTY_WARNINGS)
  const dismissedKinds = useBoardStore(
    (s) => s.boards.find((b) => b.id === boardId)?.dismissedWarnings,
  )
  const boardWarningsEnabled = useSettingsStore((s) => s.boardWarningsEnabled)
  // Dismissed (acknowledged) warnings stay in the sheet but stop driving the indicator — a board
  // whose every warning is dismissed shows no icon at all.
  const activeWarnings = dismissedKinds?.length
    ? warnings.filter((w) => !dismissedKinds.includes(w.kind))
    : warnings
  const worst = worstSeverity(activeWarnings)

  // Kill switch off hides the whole surface (defensive — native already stops emitting).
  if (!boardWarningsEnabled) return null

  // Icon shows only when the board has warnings. The sheet stays mounted while open even after the
  // last warning is cleared from inside it, so it can show its empty state and animate closed rather
  // than being yanked out mid-interaction.
  if (!worst && !open) return null
  const color = severityStatus(worst ?? 'warn').color

  return (
    <>
      {worst && (
        <>
          <View style={styles.divider} />
          <View ref={anchorRef} collapsable={false}>
            <Pressable
              style={styles.button}
              onPress={() => setOpen(true)}
              testID="board-warnings-button"
              accessibilityLabel="Board warnings"
            >
              <WarningIcon size={16} color={color} weight="fill" />
            </Pressable>
          </View>
        </>
      )}

      <EdgeDrawer
        visible={open}
        triggerRef={anchorRef}
        title="Warnings"
        icon={WarningIcon}
        iconColor={color}
        onClose={() => setOpen(false)}
      >
        <BoardWarningsSheet boardId={boardId} warnings={warnings} />
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
