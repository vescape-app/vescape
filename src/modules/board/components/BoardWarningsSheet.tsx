import { StyleSheet, View } from 'react-native'
import { ShieldCheckIcon } from 'phosphor-react-native'
import type { BoardWarning } from 'vescape-core'

import { Button } from '@/components/base/Button'
import { Placeholder } from '@/components/base/Placeholder'
import { BoardWarningRow } from '@/modules/board/components/BoardWarningRow'
import { useBoardStore } from '@/modules/board/store/boardStore'

interface BoardWarningsSheetProps {
  boardId: string
  warnings: BoardWarning[]
}

/**
 * Warnings sheet for the selected Board. Active warnings list first, dismissed (acknowledged) ones
 * grayed below — dismissing never deletes from the native registry, it only persists the kind on the
 * board record, so the row stays visible here while the board warning indicator ignores it.
 */
export function BoardWarningsSheet({ boardId, warnings }: BoardWarningsSheetProps) {
  const dismissedKinds = useBoardStore(
    (s) => s.boards.find((b) => b.id === boardId)?.dismissedWarnings ?? EMPTY_KINDS,
  )
  const setWarningDismissed = useBoardStore((s) => s.setWarningDismissed)
  const dismissAllWarnings = useBoardStore((s) => s.dismissAllWarnings)

  if (warnings.length === 0) {
    return (
      <View style={styles.empty}>
        <Placeholder
          icon={ShieldCheckIcon}
          title="No warnings"
          description="This board is clean."
        />
      </View>
    )
  }

  const active = warnings.filter((w) => !dismissedKinds.includes(w.kind))
  const dismissed = warnings.filter((w) => dismissedKinds.includes(w.kind))

  return (
    <View style={styles.list}>
      {[...active, ...dismissed].map((warning) => (
        <BoardWarningRow
          key={warning.kind}
          warning={warning}
          dismissed={dismissedKinds.includes(warning.kind)}
          onSetDismissed={(kind, value) => void setWarningDismissed(boardId, kind, value)}
        />
      ))}
      {active.length > 1 && (
        <Button
          label="Dismiss all"
          variant="secondary"
          onPress={() =>
            void dismissAllWarnings(
              boardId,
              active.map((w) => w.kind),
            )
          }
        />
      )}
    </View>
  )
}

/** Stable empty array so the selector doesn't churn references for boards with nothing dismissed. */
const EMPTY_KINDS: string[] = []

const styles = StyleSheet.create({
  list: {
    gap: 10,
  },
  empty: {
    paddingVertical: 12,
  },
})
